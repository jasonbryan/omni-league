import { randomBytes } from 'node:crypto';
import { convexRun } from './convex';

export type Sport = 'beachVolleyball' | 'soccer' | 'softball';

export const SPORT_NAMES: Record<Sport, string> = {
  beachVolleyball: 'Beach volleyball',
  soccer: 'Soccer',
  softball: 'Softball',
};

export interface DivisionSeed {
  gender: 'coed' | 'mens' | 'womens';
  playersPerSide: number;
  level: 'rec' | 'b' | 'bb' | 'a' | 'aa' | 'open' | 'intermediate' | 'competitive';
  ageGroup: 'adult' | 'over30' | 'over35' | 'over40' | 'over50' | 'over55' | 'over60';
}

export interface LeagueSeed {
  name: string;
  sport: Sport;
  locations: string[];
  status?: 'draft' | 'published';
  division?: DivisionSeed;
}

export interface TenantSeed {
  name?: string;
  locations?: { name: string; address: string }[];
  leagues?: LeagueSeed[];
}

export interface Tenant {
  name: string;
  slug: string;
  path: string;
  locations: { name: string; address: string }[];
  leagues: LeagueSeed[];
}

const byName = <T extends { name: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
  });

/**
 * Call it from the test, so tests assert only on their own tenant and no reset runs between them. A
 * worker-scoped fixture may call it once for read-only tests to share; a test that writes still
 * seeds its own. Local runs only.
 */
export async function seedTenant(seed: TenantSeed = {}): Promise<Tenant> {
  const id = randomBytes(4).toString('hex');
  const name = `${seed.name ?? 'E2E Org'} ${id}`;
  const slug = `e2e-${id}`;
  const locations = seed.locations ?? [];
  const leagues = seed.leagues ?? [];
  await convexRun('testing:seedLeague', { organization: { name, slug }, locations, leagues });
  return {
    name,
    slug,
    path: `/organizations/${slug}`,
    locations: byName(locations),
    leagues: byName(leagues),
  };
}

export function numberedLocations(count: number): { name: string; address: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Location ${String(i + 1).padStart(2, '0')}`,
    address: `${i + 1} Test Road, Corpus Christi, TX 78412`,
  }));
}

export interface SeasonSeed {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  status?: 'draft' | 'published';
}

/**
 * Season n starts on the 1st of a month n months after December 2025, so the higher the number the
 * later it starts and the earlier the public league page lists it.
 */
export function numberedSeasons(count: number): SeasonSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const year = 2026 + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, '0');
    return {
      name: `Season ${n}`,
      slug: `season-${n}`,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-28`,
    };
  });
}

/** Local runs only. */
export async function seedSeasons(
  tenant: Tenant,
  leagueSlug: string,
  seasons: SeasonSeed[],
): Promise<void> {
  // One mutation, not one call per season: concurrent `testing:seedSeason` calls for one league all
  // write its `publishedSeasonCount`, and on a slow runner they fail with
  // `OptimisticConcurrencyControlFailure`. Seasons of different leagues may be seeded together.
  await convexRun('testing:seedSeasons', {
    organizationSlug: tenant.slug,
    leagueSlug,
    seasons: seasons.map((season) => ({
      name: season.name,
      slug: season.slug,
      startDate: season.startDate,
      endDate: season.endDate,
      registrationDeadline: '2025-12-01',
      playersPerSide: 4,
      minimumRosterSize: 4,
      status: season.status ?? 'published',
    })),
  });
}

/**
 * Addresses that wrap over several lines, so the fifth row starts below the fold at 1280x720 and at
 * 360x800.
 */
export function tallLocations(): { name: string; address: string }[] {
  return numberedLocations(5).map((location, i) => ({
    ...location,
    address:
      `${location.address}, Building ${i + 1}, Suite ${i + 1}00, at the north gate of the ` +
      'Corpus Christi Municipal Recreation District grounds, past the visitor parking lot',
  }));
}
