/// <reference types="vite/client" />
import type { TestConvex } from 'convex-test';
import type { Id } from './_generated/dataModel';
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

/** A program of another type, which no writer makes yet, holding a slug of the organization. */
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
