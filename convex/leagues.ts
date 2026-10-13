import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import {
  requireLeagueOrganizer,
  requireLeagueOrganizerOrForbidden,
  requireOrgAdmin,
} from './lib/access';
import {
  checkLeagueLocations,
  checkLeagueName,
  checkLeagueSlug,
  LEAGUE_MESSAGES,
  type LeagueInputError,
} from './lib/leagueInput';
import { leagueStatusValidator } from './lib/leagueStatus';
import { leagueLocationNames } from './lib/publicLeague';
import { getLeaguePublicPageReturns } from './lib/publicPage';
import { roleValidator } from './lib/roles';
import { findLeagueBySlugs } from './lib/seasonLookup';
import { sportName, sportValidator } from './lib/sports';
import { insertDraftLeague, leagueSlugTaken, publishLeague } from './lib/tenantWrites';

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
 * and writes no `sportLocations` row; `publish` (#69) counts it.
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

/**
 * Publishes a draft league (#69): it appears on the organization's public pages and is counted in
 * `leagueCount`, `sportLeagueCounts`, and the `sportLocations` rows, once, through `tenantWrites`
 * (`publishLeague`). Org admins of the league's organization and the league organizers assigned to
 * the league may publish it (`requireLeagueOrganizer`, which takes the organization from the
 * stored league and refuses an unknown league with `Not allowed`). Publishing a published league
 * succeeds and changes nothing. There is no unpublish.
 */
export const publish = mutation({
  args: { leagueId: v.id('leagues') },
  returns: v.null(),
  handler: async (ctx, { leagueId }) => {
    await requireLeagueOrganizer(ctx, leagueId);
    const league = await ctx.db.get('leagues', leagueId);
    if (!league) throw new Error('Not allowed');
    await publishLeague(ctx, league);
    return null;
  },
});

/**
 * How many leagues the organization has published (#69, #172): its `leagueCount` counter, which
 * `tenantWrites` keeps, so the number holds past `ADMIN_LEAGUES_LIMIT` and moves on its own when a
 * league is published. A counter not set yet (a row written before #100) reads 0. Org admins of the
 * organization only (`requireOrgAdmin`). The Overview's Leagues tile and "Get set up" list read it.
 */
export const publishedCount = query({
  args: { organizationId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const organization = await ctx.db.get('organizations', organizationId);
    return organization?.leagueCount ?? 0;
  },
});

/**
 * The league management page's first question (#125), asked before anything else on it: the league
 * with these slugs, for the caller who may organize it. The league is `{ leagueId, name, slug,
 * sport, status, locationNames }` (a location of another organization is left out, as in
 * `listForAdmin`), with the caller's `role` and the organization's `{ name, slug }`.
 *
 * - `null` for an unknown organization or league (`findLeagueBySlugs`), and for a draft league
 *   when the caller is not staff of its organization, so nobody outside the staff learns that a
 *   draft's slug exists. A league stored without a status counts as a draft.
 * - A `FORBIDDEN` `ConvexError` (`lib/forbidden.ts`) for every other caller who may not organize
 *   the league: not signed in, a member of none, an org admin of another organization, or a league
 *   organizer of another league. Only org admins of the league's organization and the league
 *   organizers assigned to the league get the context.
 *
 * The app shows the not-found view for `null` and the no-access view for `FORBIDDEN`, and
 * requests nothing else until it passes.
 */
export const getOrganizerContext = query({
  args: { orgSlug: v.string(), leagueSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      leagueId: v.id('leagues'),
      name: v.string(),
      slug: v.string(),
      sport: sportValidator,
      status: leagueStatusValidator,
      locationNames: v.array(v.string()),
      role: roleValidator,
      organization: v.object({ name: v.string(), slug: v.string() }),
    }),
  ),
  handler: async (ctx, args) => {
    const found = await findLeagueBySlugs(ctx, args);
    if (!found) return null;
    const { organization, league } = found;
    const access = await requireLeagueOrganizerOrForbidden(ctx, league);
    if (!access) return null;
    const locationNames: string[] = [];
    for (const id of league.locationIds) {
      const location = await ctx.db.get('locations', id);
      if (location?.organizationId === organization._id) locationNames.push(location.name);
    }
    return {
      leagueId: league._id,
      name: league.name,
      slug: league.slug,
      sport: league.sport,
      status: league.status ?? ('draft' as const),
      locationNames,
      role: access.membership.role,
      organization: { name: organization.name, slug: organization.slug },
    };
  },
});

/**
 * The public league page's header (#127): the organization's name and slug, and the league's name,
 * slug, sport display name, and location names, or `null` when there is no such page. `null` for
 * an unknown organization or league (`findLeagueBySlugs`, which reads a league slug in its own
 * organization only), and for a league that is not `published`: a draft, and a row stored without
 * a status (written before #66), so nothing public says whether a draft's slug exists. The
 * location names follow the league's own order and leave out an id of another organization's
 * location, as `organizations.listPublicLeagues` does.
 *
 * Deliberately public (convex.md, Functions): visitors and crawlers read it without signing in,
 * and the server render calls it anonymously. It reads no identity, so every caller gets the same
 * result, and returns only the fields of `publicLeaguePageValidator` (`lib/publicPage.ts`): no id,
 * status, or counter. The seasons are `seasons.listPublic`.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (ADR 0002): an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { orgSlug: v.string(), leagueSlug: v.string() },
  // The app checks saved copies against this same validator (convex/lib/publicPage.ts, #82).
  returns: getLeaguePublicPageReturns,
  handler: async (ctx, args) => {
    const found = await findLeagueBySlugs(ctx, args);
    if (found?.league.status !== 'published') return null;
    const { organization, league } = found;
    return {
      organization: { name: organization.name, slug: organization.slug },
      name: league.name,
      slug: league.slug,
      sportName: sportName(league.sport),
      locationNames: await leagueLocationNames(ctx, organization, league),
    };
  },
});
