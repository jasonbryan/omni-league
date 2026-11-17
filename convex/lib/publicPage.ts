import { v, type Infer, type Validator } from 'convex/values';
import { programTypeValidator } from './programs';
import { scoreValidator, sportValidator } from './sports';
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

// Each row names its organization, so a result needs no second query.
const searchProgramLeagueValidator = v.object({
  type: v.literal('league'),
  ...searchLeagueValidator.fields,
});

const searchProgramTournamentValidator = v.object({
  type: v.literal('tournament'),
  organization: publicLeagueOrganizationValidator,
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  locationNames: v.array(v.string()),
  divisionLabel: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  isFull: v.optional(v.boolean()),
});

const searchProgramValidator = v.union(
  searchProgramLeagueValidator,
  searchProgramTournamentValidator,
);

export type SearchProgramRow = Infer<typeof searchProgramValidator>;

const programTypeCountsValidator = v.array(
  v.object({ type: programTypeValidator, count: v.number() }),
);

export const searchProgramsValidator = v.object({
  rows: v.array(searchProgramValidator),
  more: v.boolean(),
  suggestions: v.optional(v.array(v.string())),
  facets: v.optional(publicLeagueFacetsValidator),
  typeCounts: programTypeCountsValidator,
});

export type SearchPrograms = Infer<typeof searchProgramsValidator>;

export const searchProgramsBrowseValidator = v.object({
  ...publicListValidator(searchProgramValidator).fields,
  facets: publicLeagueFacetsValidator,
  typeCounts: programTypeCountsValidator,
});

export type SearchProgramsBrowse = Infer<typeof searchProgramsBrowseValidator>;

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
          isFull: v.optional(v.boolean()),
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

const publicBracketPlaceValidator = v.union(
  v.null(),
  v.object({ name: v.string(), seed: v.optional(v.number()) }),
);

const publicBracketSideValidator = v.union(v.literal(0), v.literal(1));

// `score` and `forfeit` are optional so a copy saved before they existed stays valid.
const publicBracketGameValidator = v.object({
  teams: v.array(publicBracketPlaceValidator),
  bye: v.boolean(),
  winner: v.optional(publicBracketSideValidator),
  score: v.optional(scoreValidator),
  // The place of the team that forfeited, in place of `score`, which holds the sport's forfeit score.
  forfeit: v.optional(publicBracketSideValidator),
});

const publicBracketRoundsValidator = v.array(
  v.object({ name: v.string(), games: v.array(publicBracketGameValidator) }),
);

// Holds no ids: the page is cached and saved offline, and an id is an internal key.
// `rounds` is the winners' bracket, which a single-elimination bracket is entirely. `losers` and `grandFinal` are optional so a
// copy saved before they existed stays valid; a single-elimination bracket has neither, and a bracket of two teams has no losers' rounds.
export const publicBracketValidator = v.object({
  winner: v.optional(v.string()),
  rounds: publicBracketRoundsValidator,
  losers: v.optional(publicBracketRoundsValidator),
  grandFinal: v.optional(
    v.object({
      games: v.array(publicBracketGameValidator),
      // True for "Deciding game if needed": a second game follows if the losers' bracket team wins the first.
      decidingGame: v.boolean(),
    }),
  ),
});

export type PublicBracket = Infer<typeof publicBracketValidator>;

// Holds no ids, as the bracket does. A standings row's `cells` are text written for the sport's `columns`.
// `score` and `forfeit` are optional so an unplayed game, and a forfeit with no score, fit.
export const publicPoolValidator = v.object({
  // A string, not `poolValidator`, which would bring all of `pools.ts` into the first bundle; the letter `A` to `H`.
  pool: v.string(),
  columns: v.array(v.object({ short: v.string(), label: v.string() })),
  standings: v.array(v.object({ place: v.number(), name: v.string(), cells: v.array(v.string()) })),
  tiebreakers: v.string(),
  games: v.array(
    v.object({
      round: v.number(),
      teams: v.array(v.string()),
      winner: v.optional(publicBracketSideValidator),
      score: v.optional(scoreValidator),
      forfeit: v.optional(publicBracketSideValidator),
    }),
  ),
});

export type PublicPool = Infer<typeof publicPoolValidator>;

// `isFull`, `bracket`, and `pools` are optional so a copy saved before they existed stays valid.
export const publicTournamentPageValidator = v.object({
  ...tournamentDetailsValidator.fields,
  isFull: v.optional(v.boolean()),
  bracket: v.optional(publicBracketValidator),
  pools: v.optional(v.array(publicPoolValidator)),
});

export type PublicTournamentPage = Infer<typeof publicTournamentPageValidator>;

export const getTournamentPublicPageReturns = v.union(v.null(), publicTournamentPageValidator);

// Holds no registrant data: the page is cached and saved offline. `placesLeft` is a count, never the registrations behind it.
// `sessionId` is optional so a copy saved before it existed stays valid, and its sessions simply have no Register link.
const publicCampSessionValidator = v.object({
  sessionId: v.optional(v.id('campSessions')),
  name: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  dailyStartTime: v.optional(v.string()),
  dailyEndTime: v.optional(v.string()),
  placesLeft: v.number(),
  registrationDeadline: v.string(),
});

export const publicCampPageValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  minimumAge: v.number(),
  maximumAge: v.number(),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  sessions: v.array(publicCampSessionValidator),
});

export type PublicCampPage = Infer<typeof publicCampPageValidator>;

export const getCampPublicPageReturns = v.union(v.null(), publicCampPageValidator);

// `isFull` is optional so a copy saved before it existed stays valid.
const publicTournamentRowFields = {
  isFull: v.optional(v.boolean()),
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

const publicCampRowFields = {
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  minimumAge: v.number(),
  maximumAge: v.number(),
  locationNames: v.array(v.string()),
};

const publicCampSessionFields = {
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  placesLeft: v.number(),
};

// `sessions` are those that had not ended when the query ran, in start order, because a query does not rerun as time passes: the page picks the next one by its own clock, and `lastSessionEndDate` lets it drop a camp that has ended since.
export const publicCampsValidator = publicListValidator(
  v.object({
    ...publicCampRowFields,
    lastSessionEndDate: v.string(),
    sessions: v.array(v.object({ name: v.string(), ...publicCampSessionFields })),
  }),
);

export type PublicCamps = Infer<typeof publicCampsValidator>;

export const publicOpenCampSessionsValidator = v.array(
  v.object({ ...publicCampRowFields, sessionName: v.string(), ...publicCampSessionFields }),
);

export type PublicOpenCampSessions = Infer<typeof publicOpenCampSessionsValidator>;
