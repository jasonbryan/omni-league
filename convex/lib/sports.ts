import { v, type Infer } from 'convex/values';
import type { BracketSide } from './bracket';

export const SPORT_NAMES = {
  beachVolleyball: 'Beach volleyball',
  soccer: 'Soccer',
  softball: 'Softball',
} as const;

export const sportValidator = v.union(
  v.literal('beachVolleyball'),
  v.literal('soccer'),
  v.literal('softball'),
);

export type Sport = Infer<typeof sportValidator>;

export function sportName(sport: Sport): string {
  return SPORT_NAMES[sport];
}

export const SPORT_SEGMENTS: Readonly<Record<Sport, string>> = {
  beachVolleyball: 'beach-volleyball',
  soccer: 'soccer',
  softball: 'softball',
};

export function sportSegment(sport: Sport): string {
  return SPORT_SEGMENTS[sport];
}

export function sportFromSegment(segment: string): Sport | undefined {
  return (Object.keys(SPORT_SEGMENTS) as Sport[]).find(
    (sport) => SPORT_SEGMENTS[sport] === segment,
  );
}

export const sportCountsValidator = v.object({
  beachVolleyball: v.optional(v.number()),
  soccer: v.optional(v.number()),
  softball: v.optional(v.number()),
});

export type SportCounts = Infer<typeof sportCountsValidator>;

export const ROSTER_SIZE_INPUT_MAX = 99;

const setScoreValidator = v.object({ a: v.number(), b: v.number() });

/** `a` is the first team of the game and `b` the second. */
export const scoreValidator = v.union(
  v.object({ kind: v.literal('sets'), sets: v.array(setScoreValidator) }),
  v.object({ kind: v.literal('goals'), a: v.number(), b: v.number() }),
  v.object({ kind: v.literal('runs'), a: v.number(), b: v.number() }),
);

export type Score = Infer<typeof scoreValidator>;

export type ScoreKind = Score['kind'];

export type ScoreDraft =
  | { kind: 'sets'; sets: readonly { a: number | null; b: number | null }[] }
  | { kind: 'goals' | 'runs'; a: number | null; b: number | null };

const SCORE_KINDS: Readonly<Record<Sport, ScoreKind>> = {
  beachVolleyball: 'sets',
  soccer: 'goals',
  softball: 'runs',
};

export function scoreKindOf(sport: Sport): ScoreKind {
  return SCORE_KINDS[sport];
}

export const MAX_SCORE = 99;

/** Per-sport defaults from the requirements (Schedule, scores, and standings): the owner may change them without restructuring. */
export const FORFEIT_SCORES = {
  beachVolleyball: { winner: 21, loser: 0 },
  soccer: { winner: 3, loser: 0 },
  softball: { winner: 7, loser: 0 },
} as const satisfies Record<Sport, { winner: number; loser: number }>;

const WIN_BY = 2;

export const SCORE_MESSAGES = {
  tied: 'A bracket game needs a winner, so the scores cannot be tied.',
  blank: 'Enter a score for both teams.',
  wholeNumber: `Use a whole number from 0 to ${MAX_SCORE}.`,
  wrongKind: 'This score does not fit the sport.',
  setTied: (set: number) => `Set ${set} is tied. A set needs a winner.`,
  winByTwo: (set: number) => `Set ${set} must be won by ${WIN_BY} points or more.`,
  setMissing: (set: number) => `Enter the score of set ${set}.`,
  extraSet: (set: number) => `Set ${set} is not played, because the game is already decided.`,
} as const;

export interface ScoreIssue {
  /** `a` or `b` for a team's goals or runs, `score` for the pair, `set1` to `set3` for a set. */
  field: string;
  message: string;
}

type Points = number | null;

function pointsIssue(points: Points): string | null {
  if (points === null) return SCORE_MESSAGES.blank;
  const whole = Number.isInteger(points) && points >= 0 && points <= MAX_SCORE;
  return whole ? null : SCORE_MESSAGES.wholeNumber;
}

function pairIssue(a: Points, b: Points, fieldOf: (side: 'a' | 'b') => string): ScoreIssue | null {
  const aIssue = pointsIssue(a);
  if (aIssue !== null) return { field: fieldOf('a'), message: aIssue };
  const bIssue = pointsIssue(b);
  return bIssue === null ? null : { field: fieldOf('b'), message: bIssue };
}

function wonSets(sets: readonly { a: number | null; b: number | null }[]): [number, number] {
  const won: [number, number] = [0, 0];
  for (const { a, b } of sets) {
    if (a !== null && b !== null && a !== b) won[a > b ? 0 : 1]++;
  }
  return won;
}

function setsIssue(setsPerGame: number, drafted: readonly { a: Points; b: Points }[]) {
  const sets = [...drafted];
  while (sets.length > 0 && sets.at(-1)!.a === null && sets.at(-1)!.b === null) sets.pop();
  const toWin = Math.floor(setsPerGame / 2) + 1;
  const wins: [number, number] = [0, 0];
  for (const [index, set] of sets.entries()) {
    const number = index + 1;
    const field = `set${number}`;
    if (wins[0] === toWin || wins[1] === toWin || number > setsPerGame) {
      return { field, message: SCORE_MESSAGES.extraSet(number) };
    }
    if (set.a === null && set.b === null) {
      return { field, message: SCORE_MESSAGES.setMissing(number) };
    }
    const bad = pairIssue(set.a, set.b, () => field);
    if (bad) return bad;
    if (set.a === set.b) return { field, message: SCORE_MESSAGES.setTied(number) };
    if (Math.abs(set.a! - set.b!) < WIN_BY) {
      return { field, message: SCORE_MESSAGES.winByTwo(number) };
    }
    wins[set.a! > set.b! ? 0 : 1]++;
  }
  if (wins[0] < toWin && wins[1] < toWin) {
    const next = sets.length + 1;
    return { field: `set${next}`, message: SCORE_MESSAGES.setMissing(next) };
  }
  return null;
}

export function checkScore(
  sport: Sport,
  setsPerGame: number,
  score: ScoreDraft,
): ScoreIssue | null {
  if (score.kind !== scoreKindOf(sport))
    return { field: 'score', message: SCORE_MESSAGES.wrongKind };
  if (score.kind === 'sets') return setsIssue(setsPerGame, score.sets);
  const bad = pairIssue(score.a, score.b, (side) => side);
  if (bad) return bad;
  return score.a === score.b ? { field: 'score', message: SCORE_MESSAGES.tied } : null;
}

export function scoreWinnerSide(score: Score): BracketSide | null {
  if (score.kind === 'sets') {
    const [a, b] = wonSets(score.sets);
    return a === b ? null : a > b ? 0 : 1;
  }
  return score.a === score.b ? null : score.a > score.b ? 0 : 1;
}

export function forfeitScore(
  sport: Sport,
  setsPerGame: number,
  forfeitingSide: BracketSide,
): Score {
  const { winner, loser } = FORFEIT_SCORES[sport];
  const points = forfeitingSide === 0 ? { a: loser, b: winner } : { a: winner, b: loser };
  const kind = scoreKindOf(sport);
  if (kind !== 'sets') return { kind, ...points };
  const toWin = Math.floor(setsPerGame / 2) + 1;
  return { kind, sets: Array.from({ length: toWin }, () => ({ ...points })) };
}

export function scoreText(score: Score): string {
  if (score.kind !== 'sets') return `${score.a}–${score.b}`;
  return score.sets.map(({ a, b }) => `${a}–${b}`).join(', ');
}
