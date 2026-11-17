import { planBracket, roundCount, roundName, type BracketSide, type PlannedGame } from './bracket';
import type { BracketType } from './tournamentEdit';

// The server plans a double-elimination bracket; the app never imports this, so it stays out of the initial bundle.

/** `bracket` holds the winners' bracket, which a single-elimination bracket is entirely. */
export type PlayoffStage = 'bracket' | 'losers' | 'grandFinal';

export interface Place {
  stage: PlayoffStage;
  round: number;
  slot: number;
  side: BracketSide;
}

export interface PlayoffGame {
  stage: PlayoffStage;
  round: number;
  slot: number;
  /** Seed numbers; only a winners' bracket game starts with any, and `null` is a bye or a place a team has yet to fill. */
  entrants: readonly [number | null, number | null];
  /** The seed a bye sends on at once; `null` for a game that is played. */
  advances: number | null;
  winnerTo: Place | null;
  /** `null` for a bye, for a losers' bracket game (its loser is out), and for the grand final. */
  loserTo: Place | null;
}

export const GRAND_FINAL_NAMES = ['Grand final', 'Grand final, deciding game'] as const;

export function winnersRoundName(round: number, rounds: number): string {
  if (round === rounds) return 'Winners’ final';
  return rounds - round === 1 ? 'Winners’ semifinals' : `Winners’ round ${round}`;
}

export function losersRoundName(round: number, rounds: number): string {
  return round === rounds ? 'Losers’ final' : `Losers’ round ${round}`;
}

export interface PlayoffRounds {
  winners: number;
  losers: number;
  double: boolean;
}

export function playoffRoundName(
  { stage, round }: { stage: PlayoffStage | 'pool'; round: number },
  rounds: PlayoffRounds,
): string {
  if (stage === 'pool') return `Round ${round}`;
  if (stage === 'grandFinal') return GRAND_FINAL_NAMES[round - 1];
  if (stage === 'losers') return losersRoundName(round, rounds.losers);
  return rounds.double ? winnersRoundName(round, rounds.winners) : roundName(round, rounds.winners);
}

const GRAND_FINAL = { stage: 'grandFinal', round: 1, slot: 1 } as const;

interface Waiting {
  /** Where the team stands in the bracket, from 0 (top) to 1 (bottom); a game's winner stands between its two teams. */
  position: number;
  seat: (place: Place) => void;
}

const byPosition = (a: Waiting, b: Waiting) => a.position - b.position;

// A team in the losers' bracket waits until a second team is free to play it, so a bye is never a game and N teams make N - 2 losers' bracket games.
export function planDoubleBracket(teamCount: number): PlayoffGame[] {
  const winnersPlan = planBracket(teamCount);
  const rounds = roundCount(teamCount);
  const gamesIn = (round: number) => winnersPlan.filter((game) => game.round === round);

  const winners: PlayoffGame[] = winnersPlan.map((game) => ({
    stage: 'bracket',
    round: game.round,
    slot: game.slot,
    entrants: game.entrants,
    advances: game.advances,
    winnerTo: game.next
      ? { stage: 'bracket', round: game.round + 1, ...game.next }
      : { ...GRAND_FINAL, side: 0 },
    loserTo: null,
  }));
  const winnersGame = (source: PlannedGame) =>
    winners.find((game) => game.round === source.round && game.slot === source.slot)!;

  const losers: PlayoffGame[] = [];
  let round = 0;

  const loserOf = (source: PlannedGame): Waiting => ({
    position: (source.slot - 0.5) / gamesIn(source.round).length,
    seat: (place) => {
      winnersGame(source).loserTo = place;
    },
  });

  const play = (first: Waiting, second: Waiting): Waiting => {
    const slot = losers.filter((game) => game.round === round).length + 1;
    const game: PlayoffGame = {
      stage: 'losers',
      round,
      slot,
      entrants: [null, null],
      advances: null,
      winnerTo: null,
      loserTo: null,
    };
    losers.push(game);
    first.seat({ stage: 'losers', round, slot, side: 0 });
    second.seat({ stage: 'losers', round, slot, side: 1 });
    return {
      position: (first.position + second.position) / 2,
      seat: (place) => {
        game.winnerTo = place;
      },
    };
  };

  const pairUp = (waiting: Waiting[]): Waiting[] => {
    const sorted = [...waiting].sort(byPosition);
    if (sorted.length < 2) return sorted;
    round += 1;
    const played = Array.from({ length: Math.floor(sorted.length / 2) }, (_, index) =>
      play(sorted[2 * index], sorted[2 * index + 1]),
    );
    return sorted.length % 2 === 1 ? [...played, sorted[sorted.length - 1]] : played;
  };

  // Each survivor meets the dropping team from the far side of the bracket, which makes a rematch less likely; a dropping team left over waits.
  const dropIn = (survivors: Waiting[], dropping: Waiting[]): Waiting[] => {
    if (survivors.length > dropping.length) throw new Error('More survivors than dropping teams');
    round += 1;
    const free = [...dropping];
    const played = [...survivors].sort(byPosition).map((survivor) => {
      const distance = (candidate: Waiting) =>
        Math.abs(candidate.position - (1 - survivor.position));
      let nearest = 0;
      for (const [index, candidate] of free.entries()) {
        if (distance(candidate) < distance(free[nearest])) nearest = index;
      }
      return play(survivor, free.splice(nearest, 1)[0]);
    });
    return [...played, ...free];
  };

  let waiting = pairUp(
    gamesIn(1)
      .filter((game) => game.advances === null)
      .map(loserOf),
  );
  for (let winnersRound = 2; winnersRound <= rounds; winnersRound++) {
    waiting = dropIn(waiting, gamesIn(winnersRound).map(loserOf));
    if (winnersRound < rounds) waiting = pairUp(waiting);
  }
  waiting[0].seat({ ...GRAND_FINAL, side: 1 });

  const grandFinal: PlayoffGame = {
    ...GRAND_FINAL,
    entrants: [null, null],
    advances: null,
    winnerTo: null,
    loserTo: null,
  };
  return [...winners, ...losers, grandFinal];
}

export function planPlayoff(teamCount: number, type: BracketType): PlayoffGame[] {
  if (type === 'double') return planDoubleBracket(teamCount);
  return planBracket(teamCount).map((game) => ({
    stage: 'bracket',
    round: game.round,
    slot: game.slot,
    entrants: game.entrants,
    advances: game.advances,
    winnerTo: game.next ? { stage: 'bracket', round: game.round + 1, ...game.next } : null,
    loserTo: null,
  }));
}
