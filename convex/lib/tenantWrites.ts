// Writers for an organization with its locations and leagues, shared by the seeds: `seed:demo`
// (previews and staging) and the IS_TEST tenant seeds in `convex/testing.ts`. Until #64 adds
// organization creation, these are the only writers of these tables.
import { v, type Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { isSlug, MAX_SLUG_LENGTH, slugify } from './slugs';
import { sportValidator } from './sports';

/** A league to create; `locations` names locations of the same organization. */
export const leagueSeedValidator = v.object({
  name: v.string(),
  sport: sportValidator,
  locations: v.array(v.string()),
});

/** An organization with its locations and leagues. */
export const tenantValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  leagues: v.array(leagueSeedValidator),
});

export type LeagueSeed = Infer<typeof leagueSeedValidator>;
export type Tenant = Infer<typeof tenantValidator>;

/**
 * Inserts the organization, then its locations, then its leagues. Throws before writing when the
 * slug is malformed or taken, a location name repeats, or a league names a location the tenant
 * does not have.
 */
export async function insertTenant(ctx: MutationCtx, tenant: Tenant): Promise<Id<'organizations'>> {
  const { name, slug } = tenant.organization;
  if (!isSlug(slug)) {
    throw new Error(
      `Organization slug ${JSON.stringify(slug)} is not a slug (lowercase letters and digits ` +
        `joined by single hyphens, at most ${MAX_SLUG_LENGTH} characters)`,
    );
  }
  const taken = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();
  if (taken) throw new Error(`Organization slug ${JSON.stringify(slug)} is taken`);

  const locationNames = new Set<string>();
  for (const location of tenant.locations) {
    if (locationNames.has(location.name)) {
      throw new Error(`Location ${JSON.stringify(location.name)} is listed twice`);
    }
    locationNames.add(location.name);
  }
  for (const league of tenant.leagues) {
    for (const location of league.locations) {
      if (!locationNames.has(location)) {
        throw new Error(
          `League ${JSON.stringify(league.name)} names the unknown location ${JSON.stringify(location)}`,
        );
      }
    }
  }

  const organizationId = await ctx.db.insert('organizations', { name, slug });
  for (const location of tenant.locations) {
    await ctx.db.insert('locations', { organizationId, ...location });
  }
  for (const league of tenant.leagues) {
    await insertLeague(ctx, organizationId, league);
  }
  return organizationId;
}

/**
 * Inserts a league of `organizationId` at the named locations of that organization, with a slug
 * from its name that is unique within the organization (`name`, `name-2`, ...). Throws when a
 * location name is unknown. Returns the new league's id and slug.
 */
export async function insertLeague(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  league: LeagueSeed,
): Promise<{ leagueId: Id<'leagues'>; slug: string }> {
  const locationIds: Id<'locations'>[] = [];
  for (const name of league.locations) {
    const location = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organizationId).eq('name', name),
      )
      .first();
    if (!location) {
      throw new Error(
        `League ${JSON.stringify(league.name)} names the unknown location ${JSON.stringify(name)}`,
      );
    }
    locationIds.push(location._id);
  }
  const slug = await uniqueLeagueSlug(ctx, organizationId, slugify(league.name));
  const leagueId = await ctx.db.insert('leagues', {
    organizationId,
    name: league.name,
    slug,
    sport: league.sport,
    locationIds,
  });
  return { leagueId, slug };
}

async function uniqueLeagueSlug(
  ctx: MutationCtx,
  organizationId: Id<'organizations'>,
  base: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const slug = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    const existing = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', slug),
      )
      .first();
    if (!existing) return slug;
  }
}
