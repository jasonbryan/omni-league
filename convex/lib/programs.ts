import { v, type Infer } from 'convex/values';
import { leagueStatusValidator } from './leagueStatus';

export const programTypeValidator = v.union(
  v.literal('league'),
  v.literal('tournament'),
  v.literal('camp'),
  v.literal('training'),
);

export type ProgramType = Infer<typeof programTypeValidator>;

export const programStatusValidator = leagueStatusValidator;
