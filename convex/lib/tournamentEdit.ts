import { v, type Infer } from 'convex/values';
import type { Sport } from './sports';

// Imports only `convex/values` and other `convex/lib` files that do the same, so `convex/schema.ts` and the app can import it.

export const setsPerGameValidator = v.union(v.literal(1), v.literal(3));

export type SetsPerGame = Infer<typeof setsPerGameValidator>;

export const structureValidator = v.union(v.literal('bracket'), v.literal('pools'));

export type Structure = Infer<typeof structureValidator>;

export const DEFAULT_STRUCTURE: Structure = 'bracket';

export const bracketTypeValidator = v.union(v.literal('single'), v.literal('double'));

export type BracketType = Infer<typeof bracketTypeValidator>;

export const DEFAULT_BRACKET_TYPE: BracketType = 'single';

/** `ifNecessary` plays a second grand final game when the losers' bracket team wins the first; `single` lets the first game decide. */
export const grandFinalValidator = v.union(v.literal('ifNecessary'), v.literal('single'));

export type GrandFinal = Infer<typeof grandFinalValidator>;

export const DEFAULT_GRAND_FINAL: GrandFinal = 'ifNecessary';

export const DEFAULT_SETS_PER_GAME: SetsPerGame = 1;

export function setsPerGameIsChosen(sport: Sport): boolean {
  return sport === 'beachVolleyball';
}

export const tournamentEditableValidator = v.object({
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  maximumTeams: v.number(),
  setsPerGame: setsPerGameValidator,
  // Optional: the previous release's form sends and reads no structure.
  structure: v.optional(structureValidator),
  // Optional: the previous release's form sends and reads neither.
  bracketType: v.optional(bracketTypeValidator),
  grandFinal: v.optional(grandFinalValidator),
});

export type TournamentEditable = Infer<typeof tournamentEditableValidator>;

export function editableOf(tournament: {
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maximumTeams: number;
  setsPerGame?: SetsPerGame | undefined;
  structure?: Structure | undefined;
  bracketType?: BracketType | undefined;
  grandFinal?: GrandFinal | undefined;
}): TournamentEditable {
  return {
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline,
    maximumTeams: tournament.maximumTeams,
    setsPerGame: tournament.setsPerGame ?? DEFAULT_SETS_PER_GAME,
    structure: tournament.structure ?? DEFAULT_STRUCTURE,
    bracketType: tournament.bracketType ?? DEFAULT_BRACKET_TYPE,
    ...(tournament.grandFinal && { grandFinal: tournament.grandFinal }),
  };
}

/** Details sent without a structure, as the previous release's form sends them, leave it as it is. */
export function sameStructure(a: TournamentEditable, b: TournamentEditable): boolean {
  return a.structure === undefined || b.structure === undefined || a.structure === b.structure;
}

/** The same holds for the bracket type and the grand final. */
function sameBracket(a: TournamentEditable, b: TournamentEditable): boolean {
  return (
    (a.bracketType === undefined ||
      b.bracketType === undefined ||
      a.bracketType === b.bracketType) &&
    (a.grandFinal === undefined || b.grandFinal === undefined || a.grandFinal === b.grandFinal)
  );
}

export function sameEditable(a: TournamentEditable, b: TournamentEditable): boolean {
  return (
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.registrationDeadline === b.registrationDeadline &&
    a.maximumTeams === b.maximumTeams &&
    a.setsPerGame === b.setsPerGame &&
    sameStructure(a, b) &&
    sameBracket(a, b)
  );
}
