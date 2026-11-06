import { convexRun } from './convex';
import { seasonArgs, type SeasonSeed, type TenantArgs } from './tenant';
import type { TestUser } from './users';

export interface BatchTeam {
  leagueSlug: string;
  seasonSlug: string;
  name: string;
  captainEmail: string;
  playerEmails?: string[];
  /** Written before the minors, so an invite can predate the minor that fills the team. */
  invites?: { email: string; expiresAt: number; token?: string }[];
  minors?: { guardianEmail: string; minorName: string }[];
}

export interface SeedBatch {
  /** Created first; a batch names a tenant or an `organizationSlug`, not both. */
  tenant?: TenantArgs;
  organizationSlug?: string;
  /** Signed up through Better Auth, so each can sign in with its password. */
  users?: TestUser[];
  /** People the test never signs in as: no password is stored, so no hash is computed. */
  accounts?: TestUser[];
  memberships?: {
    email: string;
    role: 'orgAdmin' | 'leagueOrganizer';
    leagueSlugs?: string[];
  }[];
  seasons?: (SeasonSeed & { leagueSlug: string })[];
  teams?: BatchTeam[];
  waitlist?: { leagueSlug: string; seasonSlug: string; teamName: string; captainEmail: string }[];
  /** Listed oldest first. */
  freeAgents?: { leagueSlug: string; seasonSlug: string; email: string }[];
}

const LISTS = [
  'users',
  'accounts',
  'memberships',
  'seasons',
  'teams',
  'waitlist',
  'freeAgents',
] as const;

function mergeBatches(...parts: SeedBatch[]): SeedBatch {
  const merged: SeedBatch = {};
  for (const part of parts) {
    if (part.tenant) merged.tenant = part.tenant;
    if (part.organizationSlug !== undefined) merged.organizationSlug = part.organizationSlug;
    for (const key of LISTS) {
      const items = part[key];
      if (items) (merged[key] as unknown[]) = [...((merged[key] as unknown[]) ?? []), ...items];
    }
  }
  return merged;
}

/**
 * One `testing:seedBatch` call: each `convexRun` starts a CLI process, so a test seeds in one call
 * rather than a chain. Returns the teams' ids in the order listed. Local runs only.
 */
export async function seedBatch(...parts: SeedBatch[]): Promise<{ teamIds: string[] }> {
  const batch = mergeBatches(...parts);
  const { teamIds } = (await convexRun('testing:seedBatch', {
    ...batch,
    accounts: batch.accounts?.map(({ name, email }) => ({ name, email })),
    seasons: batch.seasons?.map(({ leagueSlug, ...season }) => ({
      leagueSlug,
      ...seasonArgs(season),
    })),
  })) as { teamIds: string[] };
  return { teamIds };
}
