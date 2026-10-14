import { v, type Infer, type Validator } from 'convex/values';
import { sportValidator } from './sports';

// These live apart from the function modules and import only `convex/values`, so the Angular app
// can import the same validators to check saved copies without bundling the server functions.
// Changing one changes what the app accepts as a saved copy.

export const publicSportValidator = v.object({
  key: sportValidator,
  segment: v.string(),
  name: v.string(),
  leagueCount: v.number(),
  locationCount: v.number(),
});

export const publicPageValidator = v.object({
  name: v.string(),
  slug: v.string(),
  leagueCount: v.number(),
  locationCount: v.number(),
  sportCount: v.number(),
  sports: v.array(publicSportValidator),
});

export type PublicPage = Infer<typeof publicPageValidator>;

export const getPublicPageReturns = v.union(v.null(), publicPageValidator);

const publicLocationValidator = v.object({ name: v.string(), address: v.string() });

const publicLeagueValidator = v.object({
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
});

function publicListValidator<Row extends Validator<unknown, 'required', string>>(row: Row) {
  return v.object({
    rows: v.array(row),
    page: v.number(),
    pageCount: v.number(),
    total: v.number(),
  });
}

export const publicLocationsValidator = publicListValidator(publicLocationValidator);

export const publicLeaguesValidator = publicListValidator(publicLeagueValidator);

export type PublicLocations = Infer<typeof publicLocationsValidator>;
export type PublicLeagues = Infer<typeof publicLeaguesValidator>;

export const publicLeaguePageValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
});

export type PublicLeaguePage = Infer<typeof publicLeaguePageValidator>;

export const getLeaguePublicPageReturns = v.union(v.null(), publicLeaguePageValidator);

const publicSeasonValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  formatName: v.string(),
});

export const publicSeasonsValidator = publicListValidator(publicSeasonValidator);

export type PublicSeasons = Infer<typeof publicSeasonsValidator>;

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

export const getSeasonPublicPageReturns = v.union(v.null(), publicSeasonPageValidator);
