import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireLeagueOrganizer, requireUser } from './lib/access';
import {
  checkSeasonFields,
  firstSeasonError,
  SEASON_MESSAGES,
  type SeasonInputError,
} from './lib/seasonInput';
import { publicSeasonsValidator } from './lib/publicPage';
import { findLeagueBySlugs } from './lib/seasonLookup';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatName, formatValidator } from './lib/sports';
import { insertSeason, publishSeason, seasonSlugTaken } from './lib/tenantWrites';
import { pageOf, pageRows, PUBLIC_LIST_PAGE_SIZE } from './organizations';

/**
 * Seasons `listForOrganizer` returns at most. The list is one page with no paging (#125), as the
 * admin Leagues list is (`ADMIN_LEAGUES_LIMIT`). Never taken from args.
 */
export const ORGANIZER_SEASONS_LIMIT = 200;

function refuse(error: SeasonInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

/**
 * Creates a draft season of a league (#125). Org admins of the league's organization and the
 * league organizers assigned to the league only (`requireLeagueOrganizer`, which takes the
 * organization from the stored league and refuses an unknown league with `Not allowed`). A season
 * may be created in a draft league; every new season is a `draft`.
 *
 * The rules and messages are `convex/lib/seasonInput.ts`, which the form checks too: the name is
 * trimmed and 1 to 100 characters; the slug is valid, not reserved, and unused by a season of the
 * league (drafts count; the same slug in another league is allowed); the three dates are real
 * calendar dates, the end is on or after the start, and the registration deadline is before the
 * start; the format is one of the league's sport (`formatValidator` refuses any other key before
 * the handler runs); and the minimum roster size is a whole number from the format's minimum to
 * 99. A refusal about a field is a `ConvexError` whose data is the `SeasonInputError`, the first
 * in the form's order, and nothing is written. The season is inserted through `tenantWrites`.
 */
export const create = mutation({
  args: {
    leagueId: v.id('leagues'),
    name: v.string(),
    slug: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    format: formatValidator,
    minimumRosterSize: v.number(),
  },
  returns: v.object({ seasonId: v.id('seasons') }),
  handler: async (ctx, args) => {
    const { league } = await requireLeagueOrganizer(ctx, args.leagueId);
    const refusal = firstSeasonError(checkSeasonFields(league.sport, args));
    if (refusal) refuse(refusal);
    if (await seasonSlugTaken(ctx, league._id, args.slug)) {
      refuse({
        field: 'slug',
        code: 'slugTaken',
        message: SEASON_MESSAGES.slugTaken(args.slug, league.name),
      });
    }
    const seasonId = await insertSeason(ctx, league, {
      name: args.name.trim(),
      slug: args.slug,
      startDate: args.startDate,
      endDate: args.endDate,
      registrationDeadline: args.registrationDeadline,
      format: args.format,
      minimumRosterSize: args.minimumRosterSize,
    });
    return { seasonId };
  },
});

/**
 * Publishes a draft season (#126): it is what the league's public page lists once #127 adds that
 * page, and it is written through `tenantWrites` (`publishSeason`). Org admins of the season's
 * organization and the league organizers assigned to the season's league may publish it
 * (`requireLeagueOrganizer`, with the league taken from the stored season, never from `args`). An
 * unknown season is refused with `Not allowed`, as a season of another organization is, so the
 * message does not say which ids exist; a caller who is not signed in gets `Sign in required`.
 * Publishing a season of a league that is still a draft is refused with `Publish the league
 * first`, because the season's public page lives under the league's, and the season stays a draft.
 * Publishing a published season succeeds and changes nothing, also in a draft league. There is no
 * unpublish.
 */
export const publish = mutation({
  args: { seasonId: v.id('seasons') },
  returns: v.null(),
  handler: async (ctx, { seasonId }) => {
    await requireUser(ctx);
    const season = await ctx.db.get('seasons', seasonId);
    if (!season) throw new Error('Not allowed');
    const { league } = await requireLeagueOrganizer(ctx, season.leagueId);
    if (season.status !== 'published' && league.status !== 'published') {
      throw new Error('Publish the league first');
    }
    await publishSeason(ctx, season);
    return null;
  },
});

/**
 * The league's seasons for its management page (#125), drafts included:
 * `{ seasonId, name, slug, startDate, endDate, registrationDeadline, formatName,
 * minimumRosterSize, status }`, newest start date first across both statuses (read from
 * `by_leagueId_and_startDate` in descending order), at most `ORGANIZER_SEASONS_LIMIT`. Org admins
 * of the league's organization and the league organizers assigned to the league only
 * (`requireLeagueOrganizer`); every other caller is refused.
 */
export const listForOrganizer = query({
  args: { leagueId: v.id('leagues') },
  returns: v.array(
    v.object({
      seasonId: v.id('seasons'),
      name: v.string(),
      slug: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      registrationDeadline: v.string(),
      formatName: v.string(),
      minimumRosterSize: v.number(),
      status: seasonStatusValidator,
    }),
  ),
  handler: async (ctx, { leagueId }) => {
    const { league } = await requireLeagueOrganizer(ctx, leagueId);
    const seasons = await ctx.db
      .query('seasons')
      .withIndex('by_leagueId_and_startDate', (q) => q.eq('leagueId', leagueId))
      .order('desc')
      .take(ORGANIZER_SEASONS_LIMIT);
    return seasons.map((season) => ({
      seasonId: season._id,
      name: season.name,
      slug: season.slug,
      startDate: season.startDate,
      endDate: season.endDate,
      registrationDeadline: season.registrationDeadline,
      formatName: formatName(league.sport, season.format),
      minimumRosterSize: season.minimumRosterSize,
      status: season.status,
    }));
  },
});

const EMPTY_LIST = { rows: [], page: 1, pageCount: 0, total: 0 };

/**
 * One page of the published seasons of a published league (#127), newest start date first:
 * `{ rows: [{ name, slug, startDate, endDate, formatName }], page, pageCount, total }`, with
 * `PUBLIC_LIST_PAGE_SIZE` rows or fewer. `total` is the league's `publishedSeasonCount` (a league
 * without the counter reads 0), and the page served and the page count follow
 * `organizations.pageOf`: a page that is not a whole number from 1 to the page count, or is past
 * `PUBLIC_LIST_MAX_PAGE`, serves page 1. An unknown organization or league, a league of another
 * organization, and a league that is not `published` give an empty page 1 of 0 (the page itself
 * answers 404 from `leagues.getPublicPage`).
 *
 * Offset reads, as `organizations.listPublicLocations`: page N reads the first
 * `N * PUBLIC_LIST_PAGE_SIZE` rows of `by_leagueId_and_status_and_startDate` (status `published`,
 * descending) and returns the last of them, so drafts never take a place in the 200-row reach.
 *
 * Deliberately public (convex.md, Functions): anonymous, the same result for every caller, and no
 * id, status, or registration field in a row (`publicSeasonsValidator`, `lib/publicPage.ts`).
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (ADR 0002): an anonymous public page that reads no identity and returns only published fields.
export const listPublic = query({
  args: { orgSlug: v.string(), leagueSlug: v.string(), page: v.number() },
  // The app checks saved copies against this same validator (convex/lib/publicPage.ts, #82).
  returns: publicSeasonsValidator,
  handler: async (ctx, args) => {
    const found = await findLeagueBySlugs(ctx, args);
    if (found?.league.status !== 'published') return EMPTY_LIST;
    const { league } = found;
    const total = league.publishedSeasonCount ?? 0;
    const { page, pageCount } = pageOf(total, args.page);
    // No published season by the counter (also a counter not yet backfilled): no read.
    if (pageCount === 0) return EMPTY_LIST;
    const read = await ctx.db
      .query('seasons')
      .withIndex('by_leagueId_and_status_and_startDate', (q) =>
        q.eq('leagueId', league._id).eq('status', 'published'),
      )
      .order('desc')
      .take(page * PUBLIC_LIST_PAGE_SIZE);
    return {
      rows: pageRows(read, page).map((season) => ({
        name: season.name,
        slug: season.slug,
        startDate: season.startDate,
        endDate: season.endDate,
        formatName: formatName(league.sport, season.format),
      })),
      page,
      pageCount,
      total,
    };
  },
});
