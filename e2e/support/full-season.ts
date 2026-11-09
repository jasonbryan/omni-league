import { seedBatch, type BatchTeam } from './seed-batch';
import { dateFromToday, newTenant, type SeasonSeed, type Tenant } from './tenant';
import { newUser } from './users';

export const FULL_LEAGUE = 'Full League';
export const FULL_LEAGUE_SLUG = 'full-league';
export const PACKED_LEAGUE = 'Packed League';
export const PACKED_LEAGUE_SLUG = 'packed-league';

/** Dated from today, so each keeps its phase however long the suite runs. */
export const FULL_SEASON: SeasonSeed = {
  name: 'Full Season',
  slug: 'full-season',
  startDate: dateFromToday(30),
  endDate: dateFromToday(90),
  registrationDeadline: dateFromToday(5),
  maxTeams: 2,
};
export const ROOM_SEASON: SeasonSeed = {
  name: 'Room Season',
  slug: 'room-season',
  startDate: dateFromToday(40),
  endDate: dateFromToday(100),
  registrationDeadline: dateFromToday(15),
  maxTeams: 2,
};
export const PACKED_SEASON: SeasonSeed = {
  name: 'Packed Season',
  slug: 'packed-season',
  startDate: dateFromToday(35),
  endDate: dateFromToday(95),
  registrationDeadline: dateFromToday(8),
  playersPerSide: 10,
  maxTeams: 2,
};

export interface FullSeasonTenant {
  tenant: Tenant;
  searchWord: string;
}

/** One `testing:seedBatch` call, since each `convexRun` starts a CLI process. Local runs only. */
export async function seedFullSeasonTenant(): Promise<FullSeasonTenant> {
  const { tenant, args } = newTenant({
    name: 'E2E Full Season',
    locations: [
      { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
      { name: 'Beta Diamond', address: '2 Beta Road, Corpus Christi, TX 78412' },
    ],
    leagues: [
      { name: FULL_LEAGUE, sport: 'soccer', locations: ['Alpha Field'] },
      { name: PACKED_LEAGUE, sport: 'softball', locations: ['Beta Diamond'] },
    ],
  });
  const filled = [
    [FULL_LEAGUE_SLUG, FULL_SEASON],
    [PACKED_LEAGUE_SLUG, PACKED_SEASON],
  ] as const;
  const captains = filled.flatMap(() => [newUser('Captain'), newUser('Captain')]);
  const teams: BatchTeam[] = filled.flatMap(([leagueSlug, season], i) =>
    [1, 2].map((n) => ({
      leagueSlug,
      seasonSlug: season.slug,
      name: `${season.name} Team ${n}`,
      captainEmail: captains[i * 2 + n - 1].email,
    })),
  );
  await seedBatch({
    tenant: args,
    accounts: captains,
    seasons: [
      { leagueSlug: FULL_LEAGUE_SLUG, ...FULL_SEASON },
      { leagueSlug: FULL_LEAGUE_SLUG, ...ROOM_SEASON },
      { leagueSlug: PACKED_LEAGUE_SLUG, ...PACKED_SEASON },
    ],
    teams,
  });
  return { tenant, searchWord: tenant.slug.replace(/^e2e-/, '') };
}
