import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireLeagueOrganizer, requireUser } from './lib/access';
import {
  checkSeasonFields,
  firstSeasonError,
  SEASON_MESSAGES,
  type SeasonInputError,
} from './lib/seasonInput';
import { pageOf, pageRows, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import { leagueLocationNames } from './lib/publicLeague';
import { getSeasonPublicPageReturns, publicSeasonsValidator } from './lib/publicPage';
import { findLeagueBySlugs, findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatName, formatValidator, sportName } from './lib/sports';
import { insertSeason, publishSeason, seasonSlugTaken } from './lib/tenantWrites';

export const ORGANIZER_SEASONS_LIMIT = 200;

function refuse(error: SeasonInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

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

export const publish = mutation({
  args: { seasonId: v.id('seasons') },
  returns: v.null(),
  handler: async (ctx, { seasonId }) => {
    // Signed in first, so an unknown season and another organization's season look alike.
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

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listPublic = query({
  args: { orgSlug: v.string(), leagueSlug: v.string(), page: v.number() },
  returns: publicSeasonsValidator,
  handler: async (ctx, args) => {
    const found = await findLeagueBySlugs(ctx, args);
    if (found?.league.status !== 'published') return EMPTY_LIST;
    const { league } = found;
    const total = league.publishedSeasonCount ?? 0;
    const { page, pageCount } = pageOf(total, args.page);
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

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: seasonSlugsValidator.fields,
  returns: getSeasonPublicPageReturns,
  handler: async (ctx, args) => {
    const found = await findSeasonBySlugs(ctx, args);
    // A draft answers like an unknown season, so nothing public says whether its slug exists.
    if (found?.league.status !== 'published' || found.season.status !== 'published') return null;
    const { organization, league, season } = found;
    return {
      organization: { name: organization.name, slug: organization.slug },
      league: {
        name: league.name,
        slug: league.slug,
        sportName: sportName(league.sport),
        locationNames: await leagueLocationNames(ctx, organization, league),
      },
      name: season.name,
      slug: season.slug,
      startDate: season.startDate,
      endDate: season.endDate,
      formatName: formatName(league.sport, season.format),
      minimumRosterSize: season.minimumRosterSize,
    };
  },
});
