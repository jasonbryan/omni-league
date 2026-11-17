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

/** Camp and training programs hold no search text and have no search row, so a search and a browse list only these. */
export const SEARCHABLE_PROGRAM_TYPES: readonly ProgramType[] = ['league', 'tournament'];
