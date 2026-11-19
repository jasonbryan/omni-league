import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { leagueLocations } from './publicLeague';

/** The most upcoming rows the user home gets from camps, and from training. */
export const MINE_ROWS_LIMIT = 50;

/** The newest rows read from each table, so a user with years of past registrations is not read whole. */
export const MINE_SCAN_LIMIT = 200;

export interface ProgramSummary {
  organizationName: string;
  organizationSlug: string;
  programName: string;
  programSlug: string;
  locations: string[];
}

/** A draft program answers like an unknown one, so a row of it is left out. */
export async function publishedProgramSummary(
  ctx: Pick<QueryCtx, 'db'>,
  programId: Id<'programs'>,
  organizationId: Id<'organizations'>,
): Promise<ProgramSummary | null> {
  const program = await ctx.db.get('programs', programId);
  if (program?.status !== 'published' || program.organizationId !== organizationId) return null;
  const organization = await ctx.db.get('organizations', organizationId);
  if (!organization) return null;
  const locations = await leagueLocations(ctx, organization, program);
  return {
    organizationName: organization.name,
    organizationSlug: organization.slug,
    programName: program.name,
    programSlug: program.slug,
    locations: locations.map(({ name }) => name),
  };
}

/** Looks each key up once per query, including a key that finds nothing. */
export function lookupOnce<Key extends string, Value>(
  find: (key: Key) => Promise<Value | null>,
): (key: Key) => Promise<Value | null> {
  const found = new Map<Key, Value | null>();
  return async (key) => {
    if (!found.has(key)) found.set(key, await find(key));
    return found.get(key) ?? null;
  };
}
