import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { publicCampRow, sessionRow, sessionsOf, today } from './campPublicList';
import { leagueDivisionLabel } from './leagueDivision';
import { logoUrlField } from './organizationLogo';
import { leagueLocationNames, leagueLocations, leagueRowSeasons } from './publicLeague';
import type { SearchLeagues, SearchProgramRow } from './publicPage';
import { sportName } from './sports';
import { publicTrainingRow } from './trainingPublicList';
import { tournamentIsFull } from './tournamentInput';

type OrganizationCache = Map<Id<'organizations'>, Doc<'organizations'> | null>;

async function organizationOf(ctx: QueryCtx, cache: OrganizationCache, id: Id<'organizations'>) {
  if (!cache.has(id)) cache.set(id, await ctx.db.get('organizations', id));
  return cache.get(id) ?? null;
}

async function leagueRow(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  league: Doc<'leagues'>,
): Promise<SearchLeagues['rows'][number]> {
  return {
    organization: {
      name: organization.name,
      slug: organization.slug,
      ...(await logoUrlField(ctx, organization)),
    },
    name: league.name,
    slug: league.slug,
    sportName: sportName(league.sport),
    locationNames: await leagueLocationNames(ctx, organization, league),
    divisionLabel: await leagueDivisionLabel(ctx, league),
    seasons: await leagueRowSeasons(ctx, league),
  };
}

export async function searchRows(
  ctx: QueryCtx,
  leagues: readonly Doc<'leagues'>[],
): Promise<SearchLeagues['rows']> {
  const organizations: OrganizationCache = new Map();
  const rows: SearchLeagues['rows'] = [];
  for (const league of leagues) {
    const organization = await organizationOf(ctx, organizations, league.organizationId);
    if (organization) rows.push(await leagueRow(ctx, organization, league));
  }
  return rows;
}

export function campOfProgram(
  ctx: Pick<QueryCtx, 'db'>,
  program: Doc<'programs'>,
): Promise<Doc<'camps'> | null> {
  return ctx.db
    .query('camps')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
}

export function trainingOfProgram(
  ctx: Pick<QueryCtx, 'db'>,
  program: Doc<'programs'>,
): Promise<Doc<'trainings'> | null> {
  return ctx.db
    .query('trainings')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
}

export function tournamentOfProgram(
  ctx: Pick<QueryCtx, 'db'>,
  program: Doc<'programs'>,
): Promise<Doc<'tournaments'> | null> {
  return ctx.db
    .query('tournaments')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
}

async function trainingRow(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  program: Doc<'programs'>,
): Promise<SearchProgramRow | null> {
  const training = await trainingOfProgram(ctx, program);
  if (training?.organizationId !== program.organizationId) return null;
  const row = await publicTrainingRow(ctx, organization, training, program);
  if (!row || row.lastClassDate < today()) return null;
  return {
    type: 'training',
    organization: {
      name: organization.name,
      slug: organization.slug,
      ...(await logoUrlField(ctx, organization)),
    },
    ...row,
  };
}

async function campRow(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  program: Doc<'programs'>,
): Promise<SearchProgramRow | null> {
  const camp = await campOfProgram(ctx, program);
  if (camp?.organizationId !== program.organizationId || camp.lastSessionEndDate === undefined) {
    return null;
  }
  const from = today();
  const sessions = (await sessionsOf(ctx, camp._id))
    .filter((session) => session.endDate >= from)
    .map((session) => ({ name: session.name, ...sessionRow(session) }));
  if (sessions.length === 0) return null;
  return {
    type: 'camp',
    organization: {
      name: organization.name,
      slug: organization.slug,
      ...(await logoUrlField(ctx, organization)),
    },
    ...(await publicCampRow(ctx, organization, camp, program)),
    lastSessionEndDate: camp.lastSessionEndDate,
    sessions,
  };
}

async function programRow(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  program: Doc<'programs'>,
): Promise<SearchProgramRow | null> {
  if (program.type === 'league') {
    const league = program.leagueId && (await ctx.db.get('leagues', program.leagueId));
    return league ? { type: 'league', ...(await leagueRow(ctx, organization, league)) } : null;
  }
  if (program.type === 'camp') return campRow(ctx, organization, program);
  if (program.type === 'training') return trainingRow(ctx, organization, program);
  if (program.type !== 'tournament') return null;
  const tournament = await tournamentOfProgram(ctx, program);
  if (!tournament) return null;
  return {
    type: 'tournament',
    organization: {
      name: organization.name,
      slug: organization.slug,
      ...(await logoUrlField(ctx, organization)),
    },
    name: program.name,
    slug: program.slug,
    sportName: sportName(program.sport),
    locationNames: (await leagueLocations(ctx, organization, program)).map(({ name }) => name),
    divisionLabel: await leagueDivisionLabel(ctx, program),
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline,
    isFull: tournamentIsFull(tournament),
  };
}

export async function searchProgramRows(
  ctx: QueryCtx,
  programs: readonly Doc<'programs'>[],
): Promise<SearchProgramRow[]> {
  const organizations: OrganizationCache = new Map();
  const rows: SearchProgramRow[] = [];
  for (const program of programs) {
    const organization = await organizationOf(ctx, organizations, program.organizationId);
    const row = organization && (await programRow(ctx, organization, program));
    if (row) rows.push(row);
  }
  return rows;
}
