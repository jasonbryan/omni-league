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

export const SEARCHABLE_PROGRAM_TYPES: readonly ProgramType[] = [
  'league',
  'tournament',
  'camp',
  'training',
];

/** A camp or training program has no division, so the division filters leave it listed and it adds no facet. */
export const DIVISIONLESS_PROGRAM_TYPES: readonly ProgramType[] = ['camp', 'training'];

/** The page of an earlier release renders every row that is not a league as a tournament, so a call lists a camp or a training program only when it asks for that type. */
export function searchableProgramTypes(
  withCamps: boolean | undefined,
  withTraining: boolean | undefined,
): readonly ProgramType[] {
  return SEARCHABLE_PROGRAM_TYPES.filter(
    (type) =>
      (type !== 'camp' || withCamps === true) && (type !== 'training' || withTraining === true),
  );
}
