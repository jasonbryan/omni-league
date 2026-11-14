import { formatCalendarDate } from './seasonInput';

// Imports only `convex/lib` files that import nothing from the server, so the app can import it.

export const MIN_BRACKET_TEAMS = 2;

export type BracketSide = 0 | 1;

export interface PlannedGame {
  /** From 1, the first round played. */
  round: number;
  /** From 1, top to bottom within the round. */
  slot: number;
  /** Seed numbers, `null` for a bye or for a place a winner has yet to fill. */
  entrants: readonly [number | null, number | null];
  /** The seed a bye sends on at once; `null` for a game that is played. */
  advances: number | null;
  next: { slot: number; side: BracketSide } | null;
}

export const BRACKET_MESSAGES = {
  tooFewTeams: `A bracket needs at least ${MIN_BRACKET_TEAMS} confirmed teams.`,
  registrationOpen: (registrationDeadline: string) =>
    `Registration is open until ${formatCalendarDate(registrationDeadline)}. Create the bracket after it closes.`,
  bracketExists: 'This tournament has a bracket already. Recreate it to replace it.',
  resultEntered: 'A result is entered, so the bracket cannot be recreated.',
  seedsLocked: 'A result is entered, so the seeds cannot change.',
  notSeeded: (teamName: string) => `${teamName} is not among the seeds.`,
  firstSeed: (teamName: string) => `${teamName} is seed 1 already.`,
  lastSeed: (teamName: string) => `${teamName} is the last seed already.`,
  setsPerGameLocked: 'Sets per game cannot change once the bracket is created.',
  registrationReopened:
    'The bracket is created, so registration cannot reopen. Choose a deadline that has passed.',
  gameNotReady: 'This game is waiting on an earlier result, so it has no result yet.',
  resultExists: 'This game has a result already. Correct it instead.',
  noResult: 'This game has no result.',
  nextGamePlayed: 'The next game has a result, so this result cannot change.',
  resultChanged: 'Someone else changed this result first. The game shows their result now.',
  reportsClosed: 'This game has a result, so it takes no more score reports.',
  reportChanged: 'The team reported a different score first. The game shows it now.',
} as const;

export const BRACKET_REFUSAL_CODES = [
  'tooFewTeams',
  'registrationOpen',
  'bracketExists',
  'resultEntered',
  'seedsLocked',
  'notSeeded',
  'firstSeed',
  'lastSeed',
  'setsPerGameLocked',
  'registrationReopened',
  'gameNotReady',
  'invalidScore',
  'resultExists',
  'noResult',
  'nextGamePlayed',
  'resultChanged',
  'reportsClosed',
  'reportChanged',
] as const;

export type BracketRefusalCode = (typeof BRACKET_REFUSAL_CODES)[number];

export interface BracketRefusal {
  code: BracketRefusalCode;
  message: string;
}

/** A team is confirmed once its roster meets the minimum; tournaments have no fees yet. */
export function isConfirmedTeam(team: { rosterCount: number }, minimumRosterSize: number): boolean {
  return team.rosterCount >= minimumRosterSize;
}

interface Seedable {
  /** When the team was written, which no two teams share, so it is the registration order. */
  _creationTime: number;
  seed?: number | undefined;
}

export function inSeedOrder<T extends Seedable>(teams: readonly T[]): T[] {
  return [...teams].sort(
    (a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity) || a._creationTime - b._creationTime,
  );
}

function slotsFor(teamCount: number): number {
  let slots = MIN_BRACKET_TEAMS;
  while (slots < teamCount) slots *= 2;
  return slots;
}

export function roundCount(teamCount: number): number {
  return Math.log2(slotsFor(teamCount));
}

export function roundName(round: number, rounds: number): string {
  const remaining = rounds - round;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semifinals';
  if (remaining === 2) return 'Quarterfinals';
  return `Round of ${2 ** (remaining + 1)}`;
}

// Each step pairs a seed with the one that sums to the next round's total, so seeds 1 and 2 meet only in the Final.
function standardOrder(slots: number): number[] {
  let order = [1];
  while (order.length < slots) {
    const total = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, total - seed]);
  }
  return order;
}

export function planBracket(teamCount: number): PlannedGame[] {
  if (!Number.isInteger(teamCount) || teamCount < MIN_BRACKET_TEAMS) {
    throw new Error(`A bracket needs at least ${MIN_BRACKET_TEAMS} teams`);
  }
  const slots = slotsFor(teamCount);
  const rounds = roundCount(teamCount);
  const seedAt = (seed: number) => (seed <= teamCount ? seed : null);
  const order = standardOrder(slots);
  const games: PlannedGame[] = [];
  for (let round = 1; round <= rounds; round++) {
    const gameCount = slots / 2 ** round;
    for (let slot = 1; slot <= gameCount; slot++) {
      const entrants: [number | null, number | null] =
        round === 1 ? [seedAt(order[2 * slot - 2]), seedAt(order[2 * slot - 1])] : [null, null];
      const bye = round === 1 && entrants[1] === null;
      games.push({
        round,
        slot,
        entrants,
        advances: bye ? entrants[0] : null,
        next: round === rounds ? null : { slot: Math.ceil(slot / 2), side: slot % 2 === 1 ? 0 : 1 },
      });
    }
  }
  return placeByes(games);
}

function placeByes(games: PlannedGame[]): PlannedGame[] {
  return games.map((game) => {
    if (game.round === 1) return game;
    const entrants: [number | null, number | null] = [null, null];
    for (const feeder of games) {
      if (feeder.round !== game.round - 1 || feeder.advances === null) continue;
      if (feeder.next?.slot === game.slot) entrants[feeder.next.side] = feeder.advances;
    }
    return { ...game, entrants };
  });
}
