/// <reference types="vite/client" />
import type { TestConvex } from 'convex-test';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { defaultDivision } from './lib/tenantWrites';
import type schema from './schema';
import type { Sport } from './lib/sports';
// The docs' "./**/!(*.*.*)*.*s" pattern matches nothing on Vite 8.
export const modules = import.meta.glob(['./**/*.{js,ts}', '!./**/*.*.{js,ts}']);

export async function setTeamCounts(
  t: { run: TestConvex<typeof schema>['run'] },
  counts: Record<string, { teamCount: number; waitlistCount?: number }>,
): Promise<void> {
  await t.run(async (ctx) => {
    for (const season of await ctx.db.query('seasons').collect()) {
      const count = counts[season.slug];
      if (count) await ctx.db.patch('seasons', season._id, count);
    }
  });
}

export function organizationListFields(name: string) {
  return { sortName: name.toLowerCase(), hasPublishedLeague: false };
}

export function leagueRequiredFields(sport: Sport, name: string) {
  return { ...defaultDivision(sport), searchText: name };
}

export function tournamentProgramFields(organizationId: Id<'organizations'>, slug: string) {
  return {
    ...defaultDivision('soccer'),
    organizationId,
    type: 'tournament' as const,
    name: slug,
    sortName: slug,
    slug,
    sport: 'soccer' as const,
    status: 'published' as const,
    locationIds: [],
  };
}

/** Inserts a league the way the tenant writers do, with the league-type program row it requires. */
export async function insertLeagueWithProgram(
  ctx: Pick<MutationCtx, 'db'>,
  league: Omit<Doc<'leagues'>, '_id' | '_creationTime' | 'programId'>,
): Promise<Id<'leagues'>> {
  const programId = await ctx.db.insert('programs', {
    organizationId: league.organizationId,
    type: 'league',
    name: league.name,
    sortName: league.name.toLowerCase(),
    slug: league.slug,
    sport: league.sport,
    status: league.status ?? 'published',
    locationIds: league.locationIds,
    gender: league.gender,
    playersPerSide: league.playersPerSide,
    level: league.level,
    customLevelId: league.customLevelId,
    ageGroup: league.ageGroup,
  });
  const leagueId = await ctx.db.insert('leagues', { ...league, programId });
  await ctx.db.patch('programs', programId, { leagueId });
  return leagueId;
}
