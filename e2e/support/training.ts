import { convexRun } from './convex';
import type { Sport, Tenant } from './tenant';

export interface TrainingSeed {
  name: string;
  slug: string;
  sport?: Sport;
  locations: string[];
  coachName: string;
  minimumAge?: number;
  maximumAge?: number;
}

/** Local runs only. */
export async function seedTraining(tenant: Tenant, training: TrainingSeed): Promise<string> {
  const { slug } = (await convexRun('testing:seedTraining', {
    organizationSlug: tenant.slug,
    name: training.name,
    slug: training.slug,
    sport: training.sport ?? 'beachVolleyball',
    locationNames: training.locations,
    coachName: training.coachName,
    ...(training.minimumAge !== undefined && { minimumAge: training.minimumAge }),
    ...(training.maximumAge !== undefined && { maximumAge: training.maximumAge }),
  })) as { slug: string };
  return slug;
}
