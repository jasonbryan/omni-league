import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { ageGroupValidator, genderValidator, standardLevelValidator } from './lib/divisions';
import { freeAgentStatusValidator } from './lib/freeAgent';
import { participantValidator } from './lib/individualRegistration';
import { inviteStatusValidator } from './lib/inviteStatus';
import { leagueStatusValidator } from './lib/leagueStatus';
import { poolValidator } from './lib/pools';
import { programStatusValidator, programTypeValidator } from './lib/programs';
import { roleValidator } from './lib/roles';
import { rosterEntrySourceValidator, rosterEntryStatusValidator } from './lib/rosterEntry';
import { seasonStatusValidator } from './lib/seasonStatus';
import { scoreValidator, sportCountsValidator, sportValidator } from './lib/sports';
import {
  bracketTypeValidator,
  grandFinalValidator,
  setsPerGameValidator,
  structureValidator,
} from './lib/tournamentEdit';
import { trainingClassStatusValidator, trainingPatternValidator } from './lib/trainingPattern';
import { waitlistEntryStatusValidator } from './lib/waitlist';

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    name: v.string(),
    adultConfirmedAt: v.number(),
  }).index('by_authUserId', ['authUserId']),

  // A row exists for unknown addresses too, so a throttled sign-in cannot reveal which addresses
  // have accounts.
  signInFailures: defineTable({
    email: v.string(),
    failures: v.number(),
    blockedUntil: v.number(),
  }).index('by_email', ['email']),

  ipRateLimits: defineTable({
    key: v.string(),
    count: v.number(),
    lastRequest: v.number(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_expiresAt', ['expiresAt']),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    cityState: v.optional(v.string()),
    leagueCount: v.optional(v.number()),
    draftLeagueCount: v.optional(v.number()),
    locationCount: v.optional(v.number()),
    staffCount: v.optional(v.number()),
    pendingInviteCount: v.optional(v.number()),
    sportLeagueCounts: v.optional(sportCountsValidator),
    sportLocationCounts: v.optional(sportCountsValidator),
    sortName: v.string(),
    hasPublishedLeague: v.boolean(),
    logoStorageId: v.optional(v.id('_storage')),
  })
    .index('by_slug', ['slug'])
    .index('by_hasPublishedLeague_and_sortName', ['hasPublishedLeague', 'sortName'])
    .index('by_logoStorageId', ['logoStorageId']),

  memberships: defineTable({
    userId: v.id('users'),
    organizationId: v.id('organizations'),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    /** Programs of a type other than league that the organizer runs; absent means none. */
    programIds: v.optional(v.array(v.id('programs'))),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_userId_and_organizationId', ['userId', 'organizationId']),

  // Written only through `convex/lib/inviteWrites.ts`, which keeps the organization's `pendingInviteCount`; the one exception is `testing:resetSchemaBatch`, which empties every table, organizations included.
  invites: defineTable({
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    /** Programs of a type other than league the invite assigns; absent means none. */
    programIds: v.optional(v.array(v.id('programs'))),
    // Only the hash is stored, so a database read cannot reveal a usable invite link.
    tokenHash: v.string(),
    expiresAt: v.number(),
    status: inviteStatusValidator,
    revokedAt: v.optional(v.number()),
  })
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_email_and_status', ['organizationId', 'email', 'status'])
    .index('by_tokenHash', ['tokenHash']),

  locations: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    address: v.string(),
    // `name` lowercased: Convex indexes sort case-sensitively.
    sortName: v.optional(v.string()),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName']),

  leagues: defineTable({
    organizationId: v.id('organizations'),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationIds: v.array(v.id('locations')),
    // `name` lowercased: Convex indexes sort case-sensitively.
    sortName: v.optional(v.string()),
    status: v.optional(leagueStatusValidator),
    publishedSeasonCount: v.optional(v.number()),
    /** The league's `programs` row, kept in step by `convex/lib/tenantWrites.ts`. */
    programId: v.id('programs'),
    gender: genderValidator,
    playersPerSide: v.number(),
    /** Always a standard level, the value filters use; `customLevelId` is the label shown instead. */
    level: standardLevelValidator,
    customLevelId: v.optional(v.id('customLevels')),
    ageGroup: ageGroupValidator,
    /** Absent means `playersPerSide`; when set it is at least that, and at most `ROSTER_SIZE_INPUT_MAX`. */
    minimumRosterSize: v.optional(v.number()),
    /** The words a search finds the league by: its name, its organization's name, its locations' names, and City, state. */
    searchText: v.string(),
  })
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_slug', ['organizationId', 'slug'])
    .index('by_organizationId_and_sortName', ['organizationId', 'sortName'])
    .index('by_organizationId_and_status_and_sortName', ['organizationId', 'status', 'sortName'])
    .index('by_organizationId_and_sport_and_status_and_sortName', [
      'organizationId',
      'sport',
      'status',
      'sortName',
    ])
    .index('by_status_and_sport_and_sortName', ['status', 'sport', 'sortName'])
    .searchIndex('search_searchText', {
      searchField: 'searchText',
      filterFields: ['status', 'sport'],
    }),

  // The fields every program type shares, so a slug is unique across types and one index lists them. The tenant writers keep a league's row equal to the league.
  programs: defineTable({
    organizationId: v.id('organizations'),
    type: programTypeValidator,
    name: v.string(),
    // `name` lowercased: Convex indexes sort case-sensitively.
    sortName: v.string(),
    slug: v.string(),
    sport: sportValidator,
    status: programStatusValidator,
    locationIds: v.array(v.id('locations')),
    gender: genderValidator,
    playersPerSide: v.number(),
    level: standardLevelValidator,
    customLevelId: v.optional(v.id('customLevels')),
    ageGroup: ageGroupValidator,
    /** Set on a program of the league type. */
    leagueId: v.optional(v.id('leagues')),
    /** The words a search finds the program by: its name, sport, division, organization's name, locations' names, and City, state; a camp's or training program's hold no division words. Absent on a program written before its type was searchable. */
    searchText: v.optional(v.string()),
  })
    .index('by_organizationId_and_slug', ['organizationId', 'slug'])
    .index('by_customLevelId', ['customLevelId'])
    .index('by_organizationId_and_type_and_status_and_sortName', [
      'organizationId',
      'type',
      'status',
      'sortName',
    ])
    .index('by_status_and_type_and_sport_and_sortName', ['status', 'type', 'sport', 'sortName'])
    .searchIndex('search_searchText', {
      searchField: 'searchText',
      filterFields: ['status', 'type', 'sport'],
    }),

  // The tournament part of a program of type `tournament`; `programs` holds its name, slug, and division. Written only by `convex/lib/tenantWrites.ts`.
  tournaments: defineTable({
    programId: v.id('programs'),
    organizationId: v.id('organizations'),
    /** The program's `status` and `sport`, kept equal to it by the tenant writers so the date indexes can serve the public lists. */
    status: programStatusValidator,
    sport: sportValidator,
    /** Calendar dates, `YYYY-MM-DD`; a one-day tournament ends on its start date. */
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    maximumTeams: v.number(),
    /** Kept by `convex/lib/rosterWrites.ts`; absent on a tournament with no team yet. */
    teamCount: v.optional(v.number()),
    /** The `waiting` waitlist entries, kept by `convex/lib/rosterWrites.ts`; absent on a tournament with none yet. */
    waitlistCount: v.optional(v.number()),
    /** The division's players per side. */
    minimumRosterSize: v.number(),
    /** Pools play a round robin in each pool before the bracket; changes only while no game exists. */
    structure: structureValidator,
    /** Double elimination adds a losers' bracket and a grand final to the games; changes only while no bracket game exists. */
    bracketType: bracketTypeValidator,
    /** Absent reads as `ifNecessary`; changes only until the grand final has a result. */
    grandFinal: v.optional(grandFinalValidator),
    /** Chosen only for beach volleyball; absent reads as 1. */
    setsPerGame: v.optional(setsPerGameValidator),
  })
    .index('by_programId', ['programId'])
    .index('by_organizationId_and_startDate', ['organizationId', 'startDate'])
    .index('by_organizationId_and_status_and_endDate', ['organizationId', 'status', 'endDate'])
    .index('by_organizationId_and_sport_and_status_and_endDate', [
      'organizationId',
      'sport',
      'status',
      'endDate',
    ])
    .index('by_organizationId_and_status_and_registrationDeadline', [
      'organizationId',
      'status',
      'registrationDeadline',
    ]),

  // Written only through `convex/lib/tournamentBracket.ts`. A bye is a round 1 game with one team, already its winner.
  tournamentGames: defineTable({
    tournamentId: v.id('tournaments'),
    /** `bracket` is the winners' bracket, which a single-elimination bracket is entirely. */
    stage: v.union(
      v.literal('bracket'),
      v.literal('losers'),
      v.literal('grandFinal'),
      v.literal('pool'),
    ),
    /** The pool of a `pool` game; absent on a bracket game. */
    pool: v.optional(poolValidator),
    /** From 1, the first round played. */
    round: v.number(),
    /** From 1, top to bottom within the round. */
    slot: v.number(),
    /** Two places, `null` for one not filled yet or a bye. */
    teamIds: v.array(v.union(v.id('teams'), v.null())),
    winnerTeamId: v.optional(v.id('teams')),
    /** The game the winner joins, on `nextSide`; both are absent on the Final. */
    nextGameId: v.optional(v.id('tournamentGames')),
    nextSide: v.optional(v.union(v.literal(0), v.literal(1))),
    /** The game the loser joins, in a double-elimination bracket; absent on a bye, a losers' bracket game, and the grand final. */
    loserNextGameId: v.optional(v.id('tournamentGames')),
    loserNextSide: v.optional(v.union(v.literal(0), v.literal(1))),
    /** The result fields are set and cleared together with `winnerTeamId` of a played game; a bye has none. */
    score: v.optional(scoreValidator),
    /** The team that did not play; `score` then holds the sport's forfeit score. */
    forfeitTeamId: v.optional(v.id('teams')),
    resultEnteredAt: v.optional(v.number()),
    resultEnteredBy: v.optional(v.id('users')),
  }).index('by_tournamentId_and_stage_and_round_and_slot', [
    'tournamentId',
    'stage',
    'round',
    'slot',
  ]),

  // A captain's reported score for a game of their team, one row per team and game. Written by `convex/scoreReports.ts`, and deleted with its game or when the game's teams change by `convex/lib/tournamentBracket.ts`.
  scoreReports: defineTable({
    gameId: v.id('tournamentGames'),
    teamId: v.id('teams'),
    reportedByUserId: v.id('users'),
    /** `a` is the game's first team, as in `tournamentGames.score`. */
    score: scoreValidator,
    /** What a confirm sends back as `expected`, so it acts only on the score the organizer saw. */
    reportedAt: v.number(),
  }).index('by_gameId_and_teamId', ['gameId', 'teamId']),

  // The camp part of a program of type `camp`; `programs` holds its name, slug, sport, status, and locations. Written only by `convex/lib/tenantWrites.ts`.
  camps: defineTable({
    programId: v.id('programs'),
    organizationId: v.id('organizations'),
    /** Whole years, `MIN_CAMP_AGE` to `MAX_CAMP_AGE`, with `minimumAge` no higher than `maximumAge`. */
    minimumAge: v.number(),
    maximumAge: v.number(),
    /** Kept by `insertCampSession` and `deleteCampSession`; absent on a camp that has had no session written since it was created, which readers recount. */
    sessionCount: v.optional(v.number()),
    /** The program's `status` and `sport`, kept equal to it by the tenant writers so the date indexes can serve the public lists; absent on a camp written before they were kept, which the public lists leave out until a writer or a backfill sets them. */
    status: v.optional(programStatusValidator),
    sport: v.optional(sportValidator),
    /** The latest `endDate` of the camp's sessions, `YYYY-MM-DD`; it changes only when a session is added or deleted, never with time. Absent while the camp has no session. */
    lastSessionEndDate: v.optional(v.string()),
  })
    .index('by_programId', ['programId'])
    // The admin list reads newest first, which the status index below cannot give.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_status_and_lastSessionEndDate', [
      'organizationId',
      'status',
      'lastSessionEndDate',
    ])
    .index('by_organizationId_and_sport_and_status_and_lastSessionEndDate', [
      'organizationId',
      'sport',
      'status',
      'lastSessionEndDate',
    ]),

  campSessions: defineTable({
    campId: v.id('camps'),
    organizationId: v.id('organizations'),
    name: v.string(),
    /** Calendar dates (`YYYY-MM-DD`), with `endDate` on or after `startDate` and `registrationDeadline` on or before it. */
    startDate: v.string(),
    endDate: v.string(),
    /** `HH:MM` as stored, in 24-hour time with no time zone; both are set or neither. */
    dailyStartTime: v.optional(v.string()),
    dailyEndTime: v.optional(v.string()),
    /** Whole places, `MIN_CAMP_SESSION_PLACES` to `MAX_CAMP_SESSION_PLACES`. */
    places: v.number(),
    registrationDeadline: v.string(),
    /** The registrations in the session; a session with any cannot be deleted. */
    registeredCount: v.number(),
    /** The `waiting` entries in `campWaitlistEntries`, kept by `convex/lib/campWaitlistWrites.ts`; absent on a session written before the waitlist existed, which has none. A session with any takes no new registration. */
    waitlistCount: v.optional(v.number()),
  }).index('by_campId_and_startDate', ['campId', 'startDate']),

  // One row per participant in a camp session, written only by `convex/lib/campRegistrationWrites.ts`, which keeps `campSessions.registeredCount`. Deleting the account deletes its rows and frees their places.
  campRegistrations: defineTable({
    sessionId: v.id('campSessions'),
    campId: v.id('camps'),
    organizationId: v.id('organizations'),
    /** The account holder, who is the participant for `self` and the guardian for `minor`. */
    userId: v.id('users'),
    participant: participantValidator,
    /** `self`, or `minor:` and the lower-cased minor's name, so the one-per-participant check is an index read. */
    participantKey: v.string(),
    ageConfirmedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_sessionId_and_userId_and_participantKey', ['sessionId', 'userId', 'participantKey'])
    .index('by_userId', ['userId']),

  // People waiting for a place in a full camp session, written only by `convex/lib/campWaitlistWrites.ts`, which keeps `campSessions.waitlistCount`.
  // A waiting entry holds no place; promotion writes the registration and sets `registrationId`. Deleting the account deletes its rows.
  campWaitlistEntries: defineTable({
    sessionId: v.id('campSessions'),
    campId: v.id('camps'),
    organizationId: v.id('organizations'),
    /** The account holder, who is the participant for `self` and the guardian for `minor`. */
    userId: v.id('users'),
    participant: participantValidator,
    /** As on `campRegistrations`, so the one-per-participant check is an index read. */
    participantKey: v.string(),
    ageConfirmedAt: v.optional(v.number()),
    status: waitlistEntryStatusValidator,
    requestedAt: v.number(),
    promotedAt: v.optional(v.number()),
    registrationId: v.optional(v.id('campRegistrations')),
  })
    .index('by_sessionId_and_status_and_requestedAt', ['sessionId', 'status', 'requestedAt'])
    .index('by_sessionId_and_userId_and_participantKey', ['sessionId', 'userId', 'participantKey'])
    .index('by_userId', ['userId']),

  // The training part of a program of type `training`; `programs` holds its name, slug, sport, status, and locations. Written only by `convex/lib/tenantWrites.ts`.
  trainings: defineTable({
    programId: v.id('programs'),
    organizationId: v.id('organizations'),
    coachName: v.string(),
    /** Whole years, `MIN_TRAINING_AGE` to `MAX_TRAINING_AGE`; either bound may be absent, and `minimumAge` is no higher than `maximumAge` when both are set. */
    minimumAge: v.optional(v.number()),
    maximumAge: v.optional(v.number()),
    /** Set once, when the classes are scheduled; `trainingClasses` holds the dated classes it produced. */
    pattern: v.optional(trainingPatternValidator),
    /** The program's `status` and `sport`, kept equal to it by the tenant writers so the date indexes can serve the public lists. */
    status: v.optional(programStatusValidator),
    sport: v.optional(sportValidator),
    /** The latest date of the scheduled classes, `YYYY-MM-DD`; it changes only when classes are scheduled, cancelled, or restored, never with time. Absent while no class is scheduled. */
    lastClassDate: v.optional(v.string()),
  })
    .index('by_programId', ['programId'])
    // The admin list reads newest first, which the status index below cannot give.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_status_and_lastClassDate', [
      'organizationId',
      'status',
      'lastClassDate',
    ])
    .index('by_organizationId_and_sport_and_status_and_lastClassDate', [
      'organizationId',
      'sport',
      'status',
      'lastClassDate',
    ]),

  trainingClasses: defineTable({
    trainingId: v.id('trainings'),
    organizationId: v.id('organizations'),
    /** A calendar date (`YYYY-MM-DD`) on the pattern's weekday. */
    date: v.string(),
    /** `HH:MM` as stored, in 24-hour time with no time zone. */
    startTime: v.string(),
    endTime: v.string(),
    /** Whole places, `MIN_TRAINING_CLASS_PLACES` to `MAX_TRAINING_CLASS_PLACES`. */
    places: v.number(),
    /** The registrations in the class; a class with any cannot be cancelled. */
    registeredCount: v.number(),
    status: trainingClassStatusValidator,
  }).index('by_trainingId_and_date', ['trainingId', 'date']),

  // One row per participant in a training series or in one class, written only by `convex/lib/trainingRegistrationWrites.ts`, which keeps `trainingClasses.registeredCount`. A row without `classId` holds a place in every class of the series.
  // Deleting the account deletes its rows and frees their places.
  trainingRegistrations: defineTable({
    trainingId: v.id('trainings'),
    /** Set for a registration in one class; absent for the series. */
    classId: v.optional(v.id('trainingClasses')),
    organizationId: v.id('organizations'),
    /** The account holder, who is the participant for `self` and the guardian for `minor`. */
    userId: v.id('users'),
    participant: participantValidator,
    /** `self`, or `minor:` and the lower-cased minor's name; for one class, `class:<classId>:` before that. The one-per-participant check is an index read. */
    participantKey: v.string(),
    /** Absent when the program has no age range, which asks no age box. */
    ageConfirmedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_trainingId_and_userId_and_participantKey', [
      'trainingId',
      'userId',
      'participantKey',
    ])
    .index('by_userId', ['userId'])
    // `classId` absent reads the series rows and `classId` set reads one class's, so neither count is cut short by rows of the other kind.
    .index('by_trainingId_and_classId', ['trainingId', 'classId']),

  // People waiting for a place in every class of a full training series, written only by `convex/lib/trainingWaitlistWrites.ts`.
  // A waiting entry holds no place; promotion writes the series registration and sets `registrationId`. Deleting the account deletes its rows.
  trainingWaitlistEntries: defineTable({
    trainingId: v.id('trainings'),
    /** Set for a wait for one class; absent for the series. */
    classId: v.optional(v.id('trainingClasses')),
    organizationId: v.id('organizations'),
    /** The account holder, who is the participant for `self` and the guardian for `minor`. */
    userId: v.id('users'),
    participant: participantValidator,
    /** As on `trainingRegistrations`, so the one-per-participant check is an index read. */
    participantKey: v.string(),
    ageConfirmedAt: v.optional(v.number()),
    status: waitlistEntryStatusValidator,
    requestedAt: v.number(),
    promotedAt: v.optional(v.number()),
    registrationId: v.optional(v.id('trainingRegistrations')),
  })
    // `classId` absent reads the series entries, in the order they joined.
    .index('by_trainingId_and_classId_and_status_and_requestedAt', [
      'trainingId',
      'classId',
      'status',
      'requestedAt',
    ])
    .index('by_trainingId_and_userId_and_participantKey', [
      'trainingId',
      'userId',
      'participantKey',
    ])
    .index('by_userId', ['userId']),

  // A level an organization names for one sport (a letter class such as "D"), mapped to the
  // standard level that filters use. `nameKey` is `name` trimmed, with inner whitespace collapsed
  // and lower-cased, so names that differ only in case or spacing are one level.
  customLevels: defineTable({
    organizationId: v.id('organizations'),
    sport: sportValidator,
    name: v.string(),
    nameKey: v.string(),
    standardLevel: standardLevelValidator,
    createdAt: v.number(),
  }).index('by_organizationId_and_sport_and_nameKey', ['organizationId', 'sport', 'nameKey']),

  sportLocations: defineTable({
    organizationId: v.id('organizations'),
    sport: sportValidator,
    locationId: v.id('locations'),
    leagueCount: v.number(),
  }).index('by_organizationId_and_sport_and_locationId', ['organizationId', 'sport', 'locationId']),

  seasons: defineTable({
    organizationId: v.id('organizations'),
    leagueId: v.id('leagues'),
    name: v.string(),
    slug: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    registrationDeadline: v.string(),
    /** The league's players per side when the season was created. */
    playersPerSide: v.number(),
    minimumRosterSize: v.number(),
    status: seasonStatusValidator,
    /** Kept by `convex/lib/rosterWrites.ts`; absent on a season written before teams existed, which has none. */
    teamCount: v.optional(v.number()),
    /** Absent means no limit. */
    maxTeams: v.optional(v.number()),
    /** Absent means no limit; when set it is at least `minimumRosterSize`. */
    maxRosterSize: v.optional(v.number()),
    /** The `waiting` waitlist entries, kept by `convex/lib/rosterWrites.ts`; absent on a season written before the waitlist existed, which has none. */
    waitlistCount: v.optional(v.number()),
  })
    .index('by_leagueId_and_slug', ['leagueId', 'slug'])
    .index('by_leagueId_and_startDate', ['leagueId', 'startDate'])
    .index('by_leagueId_and_status_and_startDate', ['leagueId', 'status', 'startDate'])
    .index('by_organizationId_and_status_and_registrationDeadline', [
      'organizationId',
      'status',
      'registrationDeadline',
    ]),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps `rosterCount` and the parent's `teamCount`.
  // A team has exactly one parent: `leagueId` with `seasonId`, or `tournamentId`.
  teams: defineTable({
    organizationId: v.id('organizations'),
    leagueId: v.optional(v.id('leagues')),
    seasonId: v.optional(v.id('seasons')),
    tournamentId: v.optional(v.id('tournaments')),
    name: v.string(),
    // `name` lowercased: names are unique in a season or a tournament ignoring case.
    sortName: v.string(),
    captainUserId: v.id('users'),
    /** The team's `rostered` entries. */
    rosterCount: v.number(),
    /** The team's `pending` invites, expired ones included; absent on a team written before invites existed, which has none. */
    pendingInviteCount: v.optional(v.number()),
    createdAt: v.number(),
    /** A tournament team's place in the bracket, 1 being the top seed; absent until an organizer orders the seeds. */
    seed: v.optional(v.number()),
    /** A tournament team's pool, set when an organizer splits a Pools, then bracket tournament into pools. */
    pool: v.optional(poolValidator),
  })
    .index('by_seasonId_and_sortName', ['seasonId', 'sortName'])
    .index('by_tournamentId_and_sortName', ['tournamentId', 'sortName'])
    .index('by_seasonId_and_rosterCount', ['seasonId', 'rosterCount'])
    .index('by_captainUserId', ['captainUserId']),

  // A removed entry keeps its row, with status `removed`, so records that point at it stay valid.
  rosterEntries: defineTable({
    organizationId: v.id('organizations'),
    /** Set with the team's `seasonId`, or `tournamentId` with the team's. */
    seasonId: v.optional(v.id('seasons')),
    tournamentId: v.optional(v.id('tournaments')),
    teamId: v.id('teams'),
    /** The guardian's, when the entry is a minor's. */
    userId: v.id('users'),
    /** Set only on a minor's entry, which has no account (requirements, Accounts). */
    minorName: v.optional(v.string()),
    status: rosterEntryStatusValidator,
    source: rosterEntrySourceValidator,
    addedAt: v.number(),
    addedByUserId: v.id('users'),
    removedAt: v.optional(v.number()),
    removedByUserId: v.optional(v.id('users')),
  })
    .index('by_teamId_and_status', ['teamId', 'status'])
    .index('by_seasonId_and_userId_and_minorName_and_status', [
      'seasonId',
      'userId',
      'minorName',
      'status',
    ])
    .index('by_tournamentId_and_userId_and_minorName', ['tournamentId', 'userId', 'minorName'])
    .index('by_userId_and_status', ['userId', 'status']),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps the team's `pendingInviteCount`.
  // A pending invite is not a roster entry.
  teamInvites: defineTable({
    organizationId: v.id('organizations'),
    /** Set with the team's `seasonId`; a tournament team's invite has none, and the team names its tournament. */
    seasonId: v.optional(v.id('seasons')),
    teamId: v.id('teams'),
    /** Trimmed and lowercased, so an address matches whatever its case. */
    email: v.string(),
    // Only the hash is stored, so a database read cannot reveal a usable invite link.
    tokenHash: v.string(),
    expiresAt: v.number(),
    status: inviteStatusValidator,
    invitedByUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_teamId_and_status', ['teamId', 'status'])
    .index('by_teamId_and_email', ['teamId', 'email'])
    .index('by_tokenHash', ['tokenHash']),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps one place per person per season:
  // a free agent is not a roster entry until placement adds one.
  freeAgents: defineTable({
    organizationId: v.id('organizations'),
    seasonId: v.id('seasons'),
    userId: v.id('users'),
    status: freeAgentStatusValidator,
    registeredAt: v.number(),
    placedTeamId: v.optional(v.id('teams')),
    placedAt: v.optional(v.number()),
  })
    .index('by_seasonId_and_status_and_registeredAt', ['seasonId', 'status', 'registeredAt'])
    .index('by_seasonId_and_userId', ['seasonId', 'userId'])
    .index('by_userId_and_status', ['userId', 'status']),

  // Written only through `convex/lib/rosterWrites.ts`, which keeps the parent's `waitlistCount`. A waiting entry is not a team or a
  // roster entry, so it carries no fee; promotion turns it into a team. An entry has exactly one parent: `seasonId`, or `tournamentId`.
  waitlistEntries: defineTable({
    organizationId: v.id('organizations'),
    seasonId: v.optional(v.id('seasons')),
    tournamentId: v.optional(v.id('tournaments')),
    /** The captain. */
    userId: v.id('users'),
    teamName: v.string(),
    // `teamName` lowercased: a team name is unique across the parent's teams and waiting entries.
    sortName: v.string(),
    status: waitlistEntryStatusValidator,
    requestedAt: v.number(),
    promotedTeamId: v.optional(v.id('teams')),
    promotedAt: v.optional(v.number()),
    promotedByUserId: v.optional(v.id('users')),
  })
    .index('by_seasonId_and_status_and_requestedAt', ['seasonId', 'status', 'requestedAt'])
    .index('by_seasonId_and_userId', ['seasonId', 'userId'])
    .index('by_seasonId_and_sortName', ['seasonId', 'sortName'])
    .index('by_tournamentId_and_status_and_requestedAt', ['tournamentId', 'status', 'requestedAt'])
    .index('by_tournamentId_and_userId', ['tournamentId', 'userId'])
    .index('by_tournamentId_and_sortName', ['tournamentId', 'sortName']),

  // An endpoint is an unguessable capability URL only its browser holds, so presenting it is proof
  // enough to move its row to the caller.
  pushSubscriptions: defineTable({
    userId: v.id('users'),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    expirationTime: v.optional(v.number()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    lastSuccessAt: v.optional(v.number()),
    failureCount: v.number(),
  })
    .index('by_endpoint', ['endpoint'])
    .index('by_userId', ['userId'])
    .index('by_lastSeenAt', ['lastSeenAt']),

  // Reused for most of its 12 hours because Apple asks for no more than one new token an hour.
  // Never returned by a public function.
  pushVapidTokens: defineTable({
    origin: v.string(),
    publicKey: v.string(),
    subject: v.string(),
    authorization: v.string(),
    expiresAt: v.number(),
  })
    .index('by_origin', ['origin'])
    .index('by_expiresAt', ['expiresAt']),

  pushTestSends: defineTable({
    userId: v.id('users'),
    sentAt: v.number(),
  }).index('by_userId_and_sentAt', ['userId', 'sentAt']),
});
