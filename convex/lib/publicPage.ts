import { v, type Infer, type Validator } from 'convex/values';
import { sportValidator } from './sports';
import { tournamentDetailsValidator } from './tournamentDetails';

// These live apart from the function modules and import no function code, so the Angular app can
// import the same validators to check saved copies without bundling the server functions.
// Changing one changes what the app accepts as a saved copy.

export const publicSportValidator = v.object({
  key: sportValidator,
  segment: v.string(),
  name: v.string(),
  leagueCount: v.number(),
  locationCount: v.number(),
});

// `cityState` and `logoUrl` are optional so a copy saved before they existed stays valid.
export const publicPageValidator = v.object({
  name: v.string(),
  slug: v.string(),
  cityState: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
  leagueCount: v.number(),
  locationCount: v.number(),
  sportCount: v.number(),
  sports: v.array(publicSportValidator),
});

export type PublicPage = Infer<typeof publicPageValidator>;

export const getPublicPageReturns = v.union(v.null(), publicPageValidator);

// `sportNames`, `divisionLabel`, and `seasons` are optional so a copy saved before they existed stays valid.
const publicLocationValidator = v.object({
  name: v.string(),
  address: v.string(),
  sportNames: v.optional(v.array(v.string())),
});

// `isFull` is optional so a copy saved before it existed stays valid.
const publicLeagueSeasonValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  isFull: v.optional(v.boolean()),
});

const publicLeagueValidator = v.object({
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
  divisionLabel: v.optional(v.string()),
  seasons: v.optional(v.array(publicLeagueSeasonValidator)),
});

function publicListValidator<Row extends Validator<unknown, 'required', string>>(row: Row) {
  return v.object({
    rows: v.array(row),
    page: v.number(),
    pageCount: v.number(),
    total: v.number(),
  });
}

// The organization a league row or page names; `logoUrl` is optional so a copy saved before it existed stays valid.
const publicLeagueOrganizationValidator = v.object({
  name: v.string(),
  slug: v.string(),
  logoUrl: v.optional(v.string()),
});

// Strings, not the division validators, which would bring all of `divisions.ts` into the first bundle; the page offers only standard values.
export const publicLeagueFacetsValidator = v.array(
  v.object({
    gender: v.optional(v.string()),
    playersPerSide: v.optional(v.number()),
    level: v.optional(v.string()),
    ageGroup: v.optional(v.string()),
  }),
);

export type PublicLeagueFacets = Infer<typeof publicLeagueFacetsValidator>;

// The rows of a text search over published leagues: each names its organization, so a result needs no second query.
const searchLeagueValidator = v.object({
  organization: publicLeagueOrganizationValidator,
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
  divisionLabel: v.optional(v.string()),
  seasons: v.array(publicLeagueSeasonValidator),
});

export const searchLeaguesValidator = v.object({
  rows: v.array(searchLeagueValidator),
  more: v.boolean(),
  // Optional so a copy saved before they existed stays valid.
  suggestions: v.optional(v.array(v.string())),
  facets: v.optional(publicLeagueFacetsValidator),
});

export type SearchLeagues = Infer<typeof searchLeaguesValidator>;

export const searchLeaguesBySportValidator = v.object({
  ...publicListValidator(searchLeagueValidator).fields,
  facets: publicLeagueFacetsValidator,
});

export type SearchLeaguesBySport = Infer<typeof searchLeaguesBySportValidator>;

const searchOrganizationValidator = v.object({
  name: v.string(),
  slug: v.string(),
  sportNames: v.array(v.string()),
  cityState: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
});

export const searchOrganizationsValidator = publicListValidator(searchOrganizationValidator);

export type SearchOrganizations = Infer<typeof searchOrganizationsValidator>;

export const publicLocationsValidator = publicListValidator(publicLocationValidator);

export const publicLeaguesValidator = publicListValidator(publicLeagueValidator);

export type PublicLocations = Infer<typeof publicLocationsValidator>;
export type PublicLeagues = Infer<typeof publicLeaguesValidator>;

// `isFull` is optional so a copy saved before it existed stays valid.
const publicLeaguePageSeasonValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  minimumRosterSize: v.number(),
  isFull: v.optional(v.boolean()),
});

// `divisionLabel`, `locations`, and `seasons` are optional so a copy saved before they existed stays valid.
export const publicLeaguePageValidator = v.object({
  organization: publicLeagueOrganizationValidator,
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  divisionLabel: v.optional(v.string()),
  locationNames: v.array(v.string()),
  locations: v.optional(v.array(v.object({ name: v.string(), address: v.string() }))),
  seasons: v.optional(v.array(publicLeaguePageSeasonValidator)),
});

export type PublicLeaguePage = Infer<typeof publicLeaguePageValidator>;

export const getLeaguePublicPageReturns = v.union(v.null(), publicLeaguePageValidator);

// `registrationDeadline` and `isFull` are optional so a copy saved before they existed stays valid.
const publicSeasonValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.optional(v.string()),
  formatName: v.string(),
  isFull: v.optional(v.boolean()),
});

export const publicSeasonsValidator = publicListValidator(publicSeasonValidator);

export type PublicSeasons = Infer<typeof publicSeasonsValidator>;

// `divisionLabel`, `locations`, `upcomingSeasons`, `registrationDeadline`, and `isFull` are optional so a copy saved before they existed stays valid.
export const publicSeasonPageValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  league: v.object({
    name: v.string(),
    slug: v.string(),
    sportName: v.string(),
    locationNames: v.array(v.string()),
    divisionLabel: v.optional(v.string()),
    locations: v.optional(v.array(v.object({ name: v.string(), address: v.string() }))),
    upcomingSeasons: v.optional(
      v.array(
        v.object({
          name: v.string(),
          slug: v.string(),
          startDate: v.string(),
          registrationDeadline: v.string(),
        }),
      ),
    ),
  }),
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.optional(v.string()),
  formatName: v.string(),
  minimumRosterSize: v.number(),
  isFull: v.optional(v.boolean()),
  maxTeams: v.optional(v.number()),
});

export type PublicSeasonPage = Infer<typeof publicSeasonPageValidator>;

// Names only: a season's rosters stay visible to its teams and organizers, never on a public page.
export const publicTeamsValidator = publicListValidator(v.object({ name: v.string() }));

export type PublicTeams = Infer<typeof publicTeamsValidator>;

export const getSeasonPublicPageReturns = v.union(v.null(), publicSeasonPageValidator);

// `isFull` is optional so a copy saved before it existed stays valid.
const publicOpenSeasonValidator = v.object({
  name: v.string(),
  slug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  minimumRosterSize: v.number(),
  isFull: v.optional(v.boolean()),
  league: v.object({
    name: v.string(),
    slug: v.string(),
    sportName: v.string(),
    divisionLabel: v.optional(v.string()),
    locationNames: v.array(v.string()),
  }),
});

export const publicOpenSeasonsValidator = v.array(publicOpenSeasonValidator);

export type PublicOpenSeasons = Infer<typeof publicOpenSeasonsValidator>;

export const publicTournamentPageValidator = tournamentDetailsValidator;

export type PublicTournamentPage = Infer<typeof publicTournamentPageValidator>;

export const getTournamentPublicPageReturns = v.union(v.null(), publicTournamentPageValidator);

const publicTournamentRowFields = {
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  divisionLabel: v.string(),
  locationNames: v.array(v.string()),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
};

export const publicTournamentsValidator = publicListValidator(v.object(publicTournamentRowFields));

export type PublicTournaments = Infer<typeof publicTournamentsValidator>;

export const publicOpenTournamentsValidator = v.array(
  v.object({ ...publicTournamentRowFields, minimumRosterSize: v.number() }),
);

export type PublicOpenTournaments = Infer<typeof publicOpenTournamentsValidator>;
