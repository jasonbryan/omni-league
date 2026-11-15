import {
  RUN_DIFFERENTIAL_CAP,
  STANDINGS_RULES,
  type Score,
  type Sport,
  type StandingsColumn,
  type StandingsRanking,
  type StandingsTiebreaker,
} from './sports';

export interface StandingsGame {
  /** `score.a` is the first team's. */
  teamIds: readonly [string, string];
  score: Score;
}

interface Totals {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  cappedDifferential: number;
}

export interface StandingsRow extends Totals {
  /** From 1; teams that nothing separates share a place. */
  place: number;
}

interface Side {
  points: number;
  sets: number;
  decider: number;
}

function sidesOf(score: Score): readonly [Side, Side] {
  if (score.kind !== 'sets') {
    return [
      { points: score.a, sets: 0, decider: score.a },
      { points: score.b, sets: 0, decider: score.b },
    ];
  }
  const a: Side = { points: 0, sets: 0, decider: 0 };
  const b: Side = { points: 0, sets: 0, decider: 0 };
  for (const set of score.sets) {
    a.points += set.a;
    b.points += set.b;
    if (set.a !== set.b) (set.a > set.b ? a : b).sets++;
  }
  a.decider = a.sets;
  b.decider = b.sets;
  return [a, b];
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

function record(totals: Totals, own: Side, other: Side): void {
  totals.played++;
  if (own.decider > other.decider) totals.won++;
  else if (own.decider < other.decider) totals.lost++;
  else totals.tied++;
  totals.setsWon += own.sets;
  totals.setsLost += other.sets;
  totals.pointsFor += own.points;
  totals.pointsAgainst += other.points;
  totals.cappedDifferential += clamp(own.points - other.points, RUN_DIFFERENTIAL_CAP);
}

function totalsOf(
  teamIds: readonly string[],
  games: readonly StandingsGame[],
): Map<string, Totals> {
  const totals = new Map<string, Totals>(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        setsWon: 0,
        setsLost: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        cappedDifferential: 0,
      },
    ]),
  );
  for (const { teamIds: pair, score } of games) {
    const first = totals.get(pair[0]);
    const second = totals.get(pair[1]);
    if (!first || !second || first === second) continue;
    const [a, b] = sidesOf(score);
    record(first, a, b);
    record(second, b, a);
  }
  return totals;
}

function rankingValue(ranking: StandingsRanking, totals: Totals): number {
  if (ranking.kind === 'points') {
    return totals.won * ranking.win + totals.tied * ranking.draw + totals.lost * ranking.loss;
  }
  return totals.played === 0 ? 0 : (totals.won + totals.tied * ranking.tieWorth) / totals.played;
}

const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

const TIEBREAKER_VALUES: Record<
  StandingsTiebreaker,
  (overall: Totals, amongTied: Totals, ranking: StandingsRanking) => number
> = {
  headToHead: (_overall, amongTied, ranking) => rankingValue(ranking, amongTied),
  setWinPercentage: (overall) => share(overall.setsWon, overall.setsWon + overall.setsLost),
  pointDifferential: (overall) => overall.pointsFor - overall.pointsAgainst,
  goalDifference: (overall) => overall.pointsFor - overall.pointsAgainst,
  goalsScored: (overall) => overall.pointsFor,
  cappedRunDifferential: (overall) => overall.cappedDifferential,
  fewestRunsAllowed: (overall) => -overall.pointsAgainst,
};

function bandsBestFirst(group: readonly string[], valueOf: (teamId: string) => number): string[][] {
  const bands: string[][] = [];
  for (const teamId of [...group].sort((a, b) => valueOf(b) - valueOf(a))) {
    const band = bands.at(-1);
    if (band && valueOf(band[0]) === valueOf(teamId)) band.push(teamId);
    else bands.push([teamId]);
  }
  return bands;
}

export function standingsOf(
  sport: Sport,
  teamIds: readonly string[],
  games: readonly StandingsGame[],
): StandingsRow[] {
  const { ranking, tiebreakers } = STANDINGS_RULES[sport];
  const overall = totalsOf(teamIds, games);

  // A band the tiebreakers split is ranked again from the first tiebreaker: its head-to-head covers only its own teams.
  const separate = (group: readonly string[]): string[][] => {
    if (group.length < 2) return [[...group]];
    const amongTied = totalsOf(group, games);
    for (const tiebreaker of tiebreakers) {
      const bands = bandsBestFirst(group, (teamId) =>
        TIEBREAKER_VALUES[tiebreaker](overall.get(teamId)!, amongTied.get(teamId)!, ranking),
      );
      if (bands.length > 1) return bands.flatMap(separate);
    }
    return [[...group]];
  };

  const rows: StandingsRow[] = [];
  const level = bandsBestFirst(teamIds, (teamId) => rankingValue(ranking, overall.get(teamId)!));
  for (const band of level.flatMap(separate)) {
    const place = rows.length + 1;
    for (const teamId of band) rows.push({ ...overall.get(teamId)!, place });
  }
  return rows;
}

interface ColumnText {
  short: string;
  label: string;
}

const PLAYED = { short: 'P', label: 'Played' };
const WON = { short: 'W', label: 'Won' };
const LOST = { short: 'L', label: 'Lost' };

const COLUMN_TEXT: Record<StandingsColumn, ColumnText> = {
  played: PLAYED,
  won: WON,
  lost: LOST,
  tied: { short: 'T', label: 'Tied' },
  drawn: { short: 'D', label: 'Drawn' },
  winPercentage: { short: 'Win %', label: 'Win percentage' },
  pointDifferential: { short: '+/-', label: 'Point differential' },
  goalDifference: { short: 'GD', label: 'Goal difference' },
  points: { short: 'Pts', label: 'Points' },
};

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

function cellOf(sport: Sport, column: StandingsColumn, row: StandingsRow): string {
  switch (column) {
    case 'played':
      return String(row.played);
    case 'won':
      return String(row.won);
    case 'lost':
      return String(row.lost);
    case 'tied':
    case 'drawn':
      return String(row.tied);
    case 'winPercentage': {
      const { ranking } = STANDINGS_RULES[sport];
      return `${Math.round(rankingValue(ranking, row) * 100)}%`;
    }
    case 'pointDifferential':
    case 'goalDifference':
      return signed(row.pointsFor - row.pointsAgainst);
    case 'points':
      return String(rankingValue(STANDINGS_RULES[sport].ranking, row));
  }
}

export function standingsColumns(sport: Sport): ColumnText[] {
  return STANDINGS_RULES[sport].columns.map((column) => COLUMN_TEXT[column]);
}

export function standingsCells(sport: Sport, row: StandingsRow): string[] {
  return STANDINGS_RULES[sport].columns.map((column) => cellOf(sport, column, row));
}

const TIEBREAKER_TEXT: Record<StandingsTiebreaker, string> = {
  headToHead: 'head-to-head',
  setWinPercentage: 'set win percentage',
  pointDifferential: 'point differential',
  goalDifference: 'goal difference',
  goalsScored: 'goals scored',
  cappedRunDifferential: `run differential (at most ${RUN_DIFFERENTIAL_CAP} a game)`,
  fewestRunsAllowed: 'fewest runs allowed',
};

function tiebreakerNote(sport: Sport): string {
  const { ranking, tiebreakers } = STANDINGS_RULES[sport];
  const names = tiebreakers.map((tiebreaker) => TIEBREAKER_TEXT[tiebreaker]);
  const list = `${names.slice(0, -1).join(', ')}, then ${names.at(-1)}`;
  const ranked = ranking.kind === 'points' ? 'points' : 'win percentage';
  return `Teams level on ${ranked} are ordered by ${list}.`;
}

export const STANDINGS_TIEBREAKER_NOTES: Readonly<Record<Sport, string>> = {
  beachVolleyball: tiebreakerNote('beachVolleyball'),
  soccer: tiebreakerNote('soccer'),
  softball: tiebreakerNote('softball'),
};
