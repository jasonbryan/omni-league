import { v, type Infer } from 'convex/values';
import type { Sport } from './sports';

// Imports only `convex/values` and other `convex/lib` files that do the same, so `convex/schema.ts` and the app can import it.

export const setsPerGameValidator = v.union(v.literal(1), v.literal(3));

export type SetsPerGame = Infer<typeof setsPerGameValidator>;

export const structureValidator = v.union(v.literal('bracket'), v.literal('pools'));

export type Structure = Infer<typeof structureValidator>;

export const DEFAULT_STRUCTURE: Structure = 'bracket';

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
});

export type TournamentEditable = Infer<typeof tournamentEditableValidator>;

export function editableOf(tournament: {
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maximumTeams: number;
  setsPerGame?: SetsPerGame | undefined;
  structure?: Structure | undefined;
}): TournamentEditable {
  return {
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline,
    maximumTeams: tournament.maximumTeams,
    setsPerGame: tournament.setsPerGame ?? DEFAULT_SETS_PER_GAME,
    structure: tournament.structure ?? DEFAULT_STRUCTURE,
  };
}

/** Details sent without a structure, as the previous release's form sends them, leave it as it is. */
export function sameStructure(a: TournamentEditable, b: TournamentEditable): boolean {
  return a.structure === undefined || b.structure === undefined || a.structure === b.structure;
}

export function sameEditable(a: TournamentEditable, b: TournamentEditable): boolean {
  return (
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.registrationDeadline === b.registrationDeadline &&
    a.maximumTeams === b.maximumTeams &&
    a.setsPerGame === b.setsPerGame &&
    sameStructure(a, b)
  );
}
