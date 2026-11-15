import { convexRun } from './convex';
import { seedTenant, type Sport, type Tenant, type TenantSeed } from './tenant';

export interface CampSeed {
  name: string;
  slug: string;
  sport?: Sport;
  locations: string[];
  minimumAge: number;
  maximumAge: number;
}

/** Local runs only. */
export async function seedCamp(tenant: Tenant, camp: CampSeed): Promise<string> {
  const { slug } = (await convexRun('testing:seedCamp', {
    organizationSlug: tenant.slug,
    name: camp.name,
    slug: camp.slug,
    sport: camp.sport ?? 'beachVolleyball',
    locationNames: camp.locations,
    minimumAge: camp.minimumAge,
    maximumAge: camp.maximumAge,
  })) as { slug: string };
  return slug;
}

export interface CampSessionSeed {
  name: string;
  startDate: string;
  endDate: string;
  dailyStartTime?: string;
  dailyEndTime?: string;
  places?: number;
  registrationDeadline?: string;
  registeredCount?: number;
}

/** Skips the rules of `campSessions.add`. Local runs only. */
export async function seedCampSession(
  tenant: Tenant,
  campSlug: string,
  session: CampSessionSeed,
): Promise<void> {
  await convexRun('testing:seedCampSession', {
    organizationSlug: tenant.slug,
    campSlug,
    ...session,
    places: session.places ?? 20,
    registrationDeadline: session.registrationDeadline ?? session.startDate,
  });
}

export interface CampPageSeed extends CampSeed {
  sessions: (CampSessionSeed & { name: string })[];
  status?: 'draft' | 'published';
}

/** Skips the rules of `camps.publish`. Local runs only. */
export async function seedPublishedCamp(tenant: Tenant, camp: CampPageSeed): Promise<string> {
  const { sessions, status = 'published', ...fields } = camp;
  const slug = await seedCamp(tenant, fields);
  for (const session of sessions) await seedCampSession(tenant, slug, session);
  if (status === 'published') {
    await convexRun('testing:publishSeededCamp', {
      organizationSlug: tenant.slug,
      campSlug: slug,
    });
  }
  return `${tenant.path}/camps/${slug}`;
}

/** The tenant of `seed`, then its camps, so each names locations in `seed.locations`. Local runs only. */
export async function seedTenantWithCamps(
  seed: TenantSeed,
  camps: CampPageSeed[],
): Promise<Tenant> {
  const tenant = await seedTenant(seed);
  for (const camp of camps) await seedPublishedCamp(tenant, camp);
  return tenant;
}
