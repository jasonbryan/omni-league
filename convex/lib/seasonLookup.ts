// Applies no status or access rule: each caller applies its own.
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isSlug } from './slugs';

type Ctx = Pick<QueryCtx, 'db'>;

export interface LeagueSlugs {
  orgSlug: string;
  leagueSlug: string;
}

export const seasonSlugsValidator = v.object({
  orgSlug: v.string(),
  leagueSlug: v.string(),
  seasonSlug: v.string(),
});

export interface SeasonSlugs extends LeagueSlugs {
  seasonSlug: string;
}

export async function findLeagueBySlugs(
  ctx: Ctx,
  { orgSlug, leagueSlug }: LeagueSlugs,
): Promise<{ organization: Doc<'organizations'>; league: Doc<'leagues'> } | null> {
  if (!isSlug(orgSlug) || !isSlug(leagueSlug)) return null;
  const organization = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
    .unique();
  if (!organization) return null;
  const league = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', leagueSlug),
    )
    .unique();
  return league ? { organization, league } : null;
}

export async function findSeasonBySlugs(
  ctx: Ctx,
  slugs: SeasonSlugs,
): Promise<{
  organization: Doc<'organizations'>;
  league: Doc<'leagues'>;
  season: Doc<'seasons'>;
} | null> {
  const found = await findLeagueBySlugs(ctx, slugs);
  if (!found || !isSlug(slugs.seasonSlug)) return null;
  const season = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_slug', (q) =>
      q.eq('leagueId', found.league._id).eq('slug', slugs.seasonSlug),
    )
    .unique();
  return season ? { ...found, season } : null;
}
