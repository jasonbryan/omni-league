import { v, type Infer } from 'convex/values';
import { leagueStatusValidator } from './leagueStatus';

export const programTypeValidator = v.union(
  v.literal('league'),
  v.literal('tournament'),
  v.literal('camp'),
  v.literal('training'),
);

export type ProgramType = Infer<typeof programTypeValidator>;

export const PROGRAM_TYPES: readonly ProgramType[] = ['league', 'tournament', 'camp', 'training'];

export const programStatusValidator = leagueStatusValidator;

/** Training programs hold no search text and have no search row, so a search and a browse list only these. */
export const SEARCHABLE_PROGRAM_TYPES: readonly ProgramType[] = ['league', 'tournament', 'camp'];

/** The page of a release before camps renders every row that is not a league as a tournament, so a call that does not ask for camps lists only these. */
export const SEARCHABLE_PROGRAM_TYPES_WITHOUT_CAMPS: readonly ProgramType[] = [
  'league',
  'tournament',
];

export function searchableProgramTypes(withCamps: boolean | undefined): readonly ProgramType[] {
  return withCamps === true ? SEARCHABLE_PROGRAM_TYPES : SEARCHABLE_PROGRAM_TYPES_WITHOUT_CAMPS;
}
