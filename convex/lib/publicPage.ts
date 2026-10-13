import { v, type Infer, type Validator } from 'convex/values';
import { sportValidator } from './sports';

// The results of organizations:getPublicPage, listPublicLeagues, and listPublicLocations (#60,
// #100), leagues:getPublicPage, and seasons:listPublic (#127), and seasons:getPublicPage (#128).
// They live apart from the function modules and import only `convex/values`, so the Angular app
// can import the same validators to check saved copies (ADR 0013 section 3, #82:
// `src/app/core/data/convex/offline-saved-queries.ts`) without bundling the server functions.
// Changing one changes what the app accepts as a saved copy.

/**
 * One sport with at least one league in the organization (#101): its key, the URL segment of its
 * sport view, its display name, and its number of leagues and of distinct locations.
 */
export const publicSportValidator = v.object({
  key: sportValidator,
  segment: v.string(),
  name: v.string(),
  leagueCount: v.number(),
  locationCount: v.number(),
});

/**
 * The public organization page's header: everything but the lists (no ids, staff, or payments).
 * The three totals are the organization's, never the number of rows a list shows (#100).
 * `sports` has one entry per sport with a league, in the order of `SPORT_NAMES`, and `sportCount`
 * is its length (#101).
 */
export const publicPageValidator = v.object({
  name: v.string(),
  slug: v.string(),
  leagueCount: v.number(),
  locationCount: v.number(),
  sportCount: v.number(),
  sports: v.array(publicSportValidator),
});

export type PublicPage = Infer<typeof publicPageValidator>;

/** The `returns` validator of `organizations:getPublicPage`: the header, or `null` when none. */
export const getPublicPageReturns = v.union(v.null(), publicPageValidator);

const publicLocationValidator = v.object({ name: v.string(), address: v.string() });

const publicLeagueValidator = v.object({
  name: v.string(),
  // The URL segment of the league's public page, `/organizations/<org>/leagues/<slug>` (#127).
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
});

/** One page of a public list, with the page it is, the number of pages, and the total. */
function publicListValidator<Row extends Validator<unknown, 'required', string>>(row: Row) {
  return v.object({
    rows: v.array(row),
    page: v.number(),
    pageCount: v.number(),
    total: v.number(),
  });
}

/** The `returns` validator of `organizations:listPublicLocations`. */
export const publicLocationsValidator = publicListValidator(publicLocationValidator);

/** The `returns` validator of `organizations:listPublicLeagues`. */
export const publicLeaguesValidator = publicListValidator(publicLeagueValidator);

export type PublicLocations = Infer<typeof publicLocationsValidator>;
export type PublicLeagues = Infer<typeof publicLeaguesValidator>;

/**
 * The public league page's header (#127): the organization's name and slug, and the league's name,
 * slug, sport display name, and location names. No id, status, or counter.
 */
export const publicLeaguePageValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
});

export type PublicLeaguePage = Infer<typeof publicLeaguePageValidator>;

/** The `returns` validator of `leagues:getPublicPage`: the header, or `null` when none. */
export const getLeaguePublicPageReturns = v.union(v.null(), publicLeaguePageValidator);

/**
 * One published season in a league's list (#127): its name and slug (the season page's URL), its
 * calendar dates as stored (`YYYY-MM-DD`, no time zone), and the format's display name.
 */
const publicSeasonValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  formatName: v.string(),
});

/** The `returns` validator of `seasons:listPublic`. */
export const publicSeasonsValidator = publicListValidator(publicSeasonValidator);

export type PublicSeasons = Infer<typeof publicSeasonsValidator>;

/**
 * The public season page (#128): the organization's name and slug, the league's name, slug, sport
 * display name, and location names (the league page's header), and the season's name, slug,
 * calendar dates as stored (`YYYY-MM-DD`, no time zone), format display name, and minimum roster
 * size. No id, status, registration deadline, or counter; later slices add `registrationDeadline`
 * (#129) and `isFull` (#143).
 */
export const publicSeasonPageValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  league: v.object({
    name: v.string(),
    slug: v.string(),
    sportName: v.string(),
    locationNames: v.array(v.string()),
  }),
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  formatName: v.string(),
  minimumRosterSize: v.number(),
});

export type PublicSeasonPage = Infer<typeof publicSeasonPageValidator>;

/** The `returns` validator of `seasons:getPublicPage`: the page, or `null` when none. */
export const getSeasonPublicPageReturns = v.union(v.null(), publicSeasonPageValidator);
