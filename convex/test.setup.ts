/// <reference types="vite/client" />
import type { TestConvex } from 'convex-test';
import type schema from './schema';
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
