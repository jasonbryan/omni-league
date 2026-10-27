import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireLeagueOrganizer, requireUser } from './lib/access';
import {
  checkSeasonFields,
  firstSeasonError,
  SEASON_MESSAGES,
  type LeagueFormatMissingError,
  type SeasonInputError,
} from './lib/seasonInput';
import { pageOf, pageRows, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import { leagueLocationNames } from './lib/publicLeague';
import {
  getSeasonPublicPageReturns,
  publicOpenSeasonsValidator,
  publicSeasonsValidator,
  type PublicOpenSeasons,
} from './lib/publicPage';
import { leagueDivisionLabel } from './lib/leagueDivision';
import {
  findLeagueBySlugs,
  findOrganizationBySlug,
  findSeasonBySlugs,
  seasonSlugsValidator,
} from './lib/seasonLookup';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatLabel } from './lib/divisions';
import { seasonPlayersPerSide, sportName, sportValidator } from './lib/sports';
import { insertSeason, publishSeason, seasonSlugTaken } from './lib/tenantWrites';

export const ORGANIZER_SEASONS_LIMIT = 200;

export const OPEN_SEASONS_READ_LIMIT = 50;

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
  },
  returns: v.object({ seasonId: v.id('seasons') }),
  handler: async (ctx, args) => {
    const { league } = await requireLeagueOrganizer(ctx, args.leagueId);
    if (league.playersPerSide === undefined) {
      throw new ConvexError({
        code: 'leagueFormatMissing',
        message: SEASON_MESSAGES.leagueFormatMissing,
      } satisfies LeagueFormatMissingError);
    }
    const refusal = firstSeasonError(checkSeasonFields(args));
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
      playersPerSide: league.playersPerSide,
      minimumRosterSize: league.minimumRosterSize ?? league.playersPerSide,
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
    await requireLeagueOrganizer(ctx, leagueId);
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
      formatName: formatLabel(seasonPlayersPerSide(season)),
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
        formatName: formatLabel(seasonPlayersPerSide(season)),
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
      formatName: formatLabel(seasonPlayersPerSide(season)),
      minimumRosterSize: season.minimumRosterSize,
    };
  },
});

/**
 * The page keeps the seasons whose registration is open (`registrationIsOpen`) at the viewer's time. The query reads no clock: it would
 * neither rerun as time passes nor reuse its cache.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listOpenForOrganization = query({
  args: { orgSlug: v.string(), sport: v.optional(sportValidator) },
  returns: publicOpenSeasonsValidator,
  handler: async (ctx, { orgSlug, sport }): Promise<PublicOpenSeasons> => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return [];
    const seasons = await ctx.db
      .query('seasons')
      .withIndex('by_organizationId_and_status_and_registrationDeadline', (q) =>
        q.eq('organizationId', organization._id).eq('status', 'published'),
      )
      .order('desc')
      .take(OPEN_SEASONS_READ_LIMIT);
    const leagues = new Map<Id<'leagues'>, PublicOpenSeasons[number]['league'] | null>();
    const cards: PublicOpenSeasons = [];
    for (const season of seasons) {
      if (!leagues.has(season.leagueId)) {
        const league = await ctx.db.get('leagues', season.leagueId);
        const shown =
          league?.organizationId === organization._id &&
          league.status === 'published' &&
          (sport === undefined || league.sport === sport);
        const divisionLabel = shown ? await leagueDivisionLabel(ctx, league) : undefined;
        leagues.set(
          season.leagueId,
          shown
            ? {
                name: league.name,
                slug: league.slug,
                sportName: sportName(league.sport),
                ...(divisionLabel !== undefined && { divisionLabel }),
                locationNames: await leagueLocationNames(ctx, organization, league),
              }
            : null,
        );
      }
      const league = leagues.get(season.leagueId);
      if (!league) continue;
      cards.push({
        name: season.name,
        slug: season.slug,
        startDate: season.startDate,
        endDate: season.endDate,
        registrationDeadline: season.registrationDeadline,
        minimumRosterSize: season.minimumRosterSize,
        league,
      });
    }
    return cards;
  },
});
