import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

export type FindResults = FunctionReturnType<typeof api.search.programs>;

export type FindBrowseResults = FunctionReturnType<typeof api.search.programsBrowse>;

export type FindResultRow = FindResults['rows'][number];

export type FindLeagueRow = Extract<FindResultRow, { type: 'league' }>;

export type FindTournamentRow = Extract<FindResultRow, { type: 'tournament' }>;

export type FindCampRow = Extract<FindResultRow, { type: 'camp' }>;

export type FindTrainingRow = Extract<FindResultRow, { type: 'training' }>;

export type FindOrganizations = FunctionReturnType<typeof api.search.organizations>;

export type FindOrganizationRow = FindOrganizations['rows'][number];
