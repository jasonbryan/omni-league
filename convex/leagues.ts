import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireOrgAdmin } from './lib/access';
import {
  checkLeagueLocations,
  checkLeagueName,
  checkLeagueSlug,
  LEAGUE_MESSAGES,
  type LeagueInputError,
} from './lib/leagueInput';
import { leagueStatusValidator } from './lib/leagueStatus';
import { sportName, sportValidator } from './lib/sports';
import { insertDraftLeague, leagueSlugTaken } from './lib/tenantWrites';

/**
 * Leagues `listForAdmin` returns at most. The admin list is one page with no paging (#66), and the
 * public list reaches 200 rows too (`PUBLIC_LIST_MAX_PAGE`). Never taken from args.
 */
export const ADMIN_LEAGUES_LIMIT = 200;

function refuse(error: LeagueInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

/**
 * The organization's leagues for its admin area (#66), drafts included:
 * `{ leagueId, name, slug, sportName, status, locationNames }` sorted by name ignoring case, at
 * most `ADMIN_LEAGUES_LIMIT`. `locationNames` follow the league's own order and leave out an id of
 * another organization's location. A league stored without a status (written before #66) is
 * listed as a draft: it is on no public list either. Org admins of the organization only
 * (`requireOrgAdmin`); every other caller is refused.
 */
export const listForAdmin = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      leagueId: v.id('leagues'),
      name: v.string(),
      slug: v.string(),
      sportName: v.string(),
      status: leagueStatusValidator,
      locationNames: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_sortName', (q) => q.eq('organizationId', organizationId))
      .take(ADMIN_LEAGUES_LIMIT);
    const locationNames = new Map<Id<'locations'>, string | null>();
    const nameOf = async (id: Id<'locations'>): Promise<string | null> => {
      if (!locationNames.has(id)) {
        const location = await ctx.db.get('locations', id);
        locationNames.set(id, location?.organizationId === organizationId ? location.name : null);
      }
      return locationNames.get(id) ?? null;
    };
    const rows = [];
    for (const league of leagues) {
      const names: string[] = [];
      for (const id of league.locationIds) {
        const name = await nameOf(id);
        if (name !== null) names.push(name);
      }
      rows.push({
        leagueId: league._id,
        name: league.name,
        slug: league.slug,
        sportName: sportName(league.sport),
        status: league.status ?? ('draft' as const),
        locationNames: names,
      });
    }
    return rows;
  },
});

/**
 * Creates a draft league in the organization (#66). Org admins of the organization only. The name
 * is trimmed and must be 1 to 100 characters; the slug must be valid, not reserved, and unused by
 * a league of the organization (drafts count); the sport is one of `convex/lib/sports.ts` (the
 * `sport` validator refuses any other); and at least one location is named, each belonging to the
 * organization. The rules and messages are `convex/lib/leagueInput.ts`, which the form checks too;
 * a refusal about a field is a `ConvexError` whose data is the `LeagueInputError`, and nothing is
 * written. A location of another organization is refused with `Not allowed`, as the form never
 * offers one. The league is inserted through `tenantWrites` as a draft, which changes no counter
 * and writes no `sportLocations` row; #69 publishes it.
 */
export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationIds: v.array(v.id('locations')),
  },
  returns: v.object({ leagueId: v.id('leagues') }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const name = checkLeagueName(args.name);
    if (!name.ok) refuse(name.error);
    const slugError = checkLeagueSlug(args.slug);
    if (slugError) refuse(slugError);
    const locationIds = [...new Set(args.locationIds)];
    const locationsError = checkLeagueLocations(locationIds.length);
    if (locationsError) refuse(locationsError);
    for (const id of locationIds) {
      const location = await ctx.db.get('locations', id);
      if (location?.organizationId !== args.organizationId) throw new Error('Not allowed');
    }
    if (await leagueSlugTaken(ctx, args.organizationId, args.slug)) {
      refuse({
        field: 'slug',
        code: 'slugTaken',
        message: LEAGUE_MESSAGES.slugTaken(args.slug),
      });
    }
    const leagueId = await insertDraftLeague(ctx, args.organizationId, {
      name: name.name,
      slug: args.slug,
      sport: args.sport,
      locationIds,
    });
    return { leagueId };
  },
});
