import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireLeagueOrganizer } from './lib/access';
import {
  checkSeasonFields,
  firstSeasonError,
  SEASON_MESSAGES,
  type SeasonInputError,
} from './lib/seasonInput';
import { seasonStatusValidator } from './lib/seasonStatus';
import { formatName, formatValidator } from './lib/sports';
import { insertSeason, seasonSlugTaken } from './lib/tenantWrites';

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
