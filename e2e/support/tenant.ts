import { randomBytes } from 'node:crypto';
import { convexRun } from './convex';

export type Sport = 'beachVolleyball' | 'soccer' | 'softball';

export const SPORT_NAMES: Record<Sport, string> = {
  beachVolleyball: 'Beach volleyball',
  soccer: 'Soccer',
  softball: 'Softball',
};

export interface TenantSeed {
  /** Display name before the unique suffix; default "E2E Org". */
  name?: string;
  locations?: { name: string; address: string }[];
  leagues?: { name: string; sport: Sport; locations: string[] }[];
}

export interface Tenant {
  /** The organization's name, with this test's unique suffix. */
  name: string;
  slug: string;
  /** `/organizations/<slug>`. */
  path: string;
  /** Sorted by name, as the page lists them. */
  locations: { name: string; address: string }[];
  leagues: { name: string; sport: Sport; locations: string[] }[];
}

const byName = <T extends { name: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
  });

/**
 * Creates the calling test's own tenant through `testing:seedLeague` (ADR 0005, per-test tenant
 * fixture): an organization with a unique name and slug, with the given locations and leagues.
 * Tests assert only on their own tenant, so no reset runs between them. Local runs only.
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

/** `count` locations named "Location 01", "Location 02", ... so their order is their number. */
export function numberedLocations(count: number): { name: string; address: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Location ${String(i + 1).padStart(2, '0')}`,
    address: `${i + 1} Test Road, Corpus Christi, TX 78412`,
  }));
}
