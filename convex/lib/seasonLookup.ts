// The slug lookup behind every season-scoped route (#125): `/…/<org>/leagues/<league>/seasons/
// <season>`. A page has only slugs, so each public function behind such a route takes them and
// resolves them here (#127, #128, #129, #133, #134, #142, #145); no query returns a season id to a
// page that has only slugs. The helpers read through `organizations.by_slug`,
// `leagues.by_organizationId_and_slug`, and `seasons.by_leagueId_and_slug`, so a season slug of
// another league, or a league slug of another organization, is unknown. They apply no status or
// access rule: each caller applies its own (a public query reads only a published league and
// season; a staff function checks `convex/lib/access.ts`).
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isSlug } from './slugs';

type Ctx = Pick<QueryCtx, 'db'>;

/** The slugs of a league route. */
export interface LeagueSlugs {
  orgSlug: string;
  leagueSlug: string;
}

/** The slugs of a season route; the `args` of every public function behind one. */
export const seasonSlugsValidator = v.object({
  orgSlug: v.string(),
  leagueSlug: v.string(),
  seasonSlug: v.string(),
});

export interface SeasonSlugs extends LeagueSlugs {
  seasonSlug: string;
}

/** The league with these slugs and its organization, or `null` when either is unknown. */
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

/**
 * The season with these slugs, with its league and organization, or `null` when the organization,
 * the league, or the season is unknown. The season is looked up in that league only.
 */
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
