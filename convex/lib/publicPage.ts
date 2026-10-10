import { v, type Infer, type Validator } from 'convex/values';
import { sportValidator } from './sports';

// The results of organizations:getPublicPage, listPublicLeagues, and listPublicLocations (#60,
// #100). They live apart from organizations.ts and import only `convex/values`, so the Angular app
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
