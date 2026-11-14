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

/** Skips the rules of `camps.create`. Local runs only. */
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
