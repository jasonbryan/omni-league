import { convexRun } from './convex';
import type { Sport, Tenant } from './tenant';

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
