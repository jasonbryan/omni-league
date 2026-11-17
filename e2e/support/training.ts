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

/** Sets the count directly: nothing registers for a training class yet. Local runs only. */
export async function setTrainingClassRegistered(
  tenant: Tenant,
  trainingSlug: string,
  date: string,
  registeredCount: number,
): Promise<void> {
  await convexRun('testing:setTrainingClassRegistered', {
    organizationSlug: tenant.slug,
    trainingSlug,
    date,
    registeredCount,
  });
}

export interface TrainingClassesSeed {
  /** Sunday is 0; `firstDate` falls on it. */
  weekday: number;
  startTime: string;
  endTime: string;
  firstDate: string;
  weeks: number;
  placesPerClass?: number;
  registrationDeadline?: string;
}

/** Skips the rules of `trainingClasses.schedule`, so the classes may have passed. Local runs only. */
export async function seedTrainingClasses(
  tenant: Tenant,
  trainingSlug: string,
  classes: TrainingClassesSeed,
): Promise<void> {
  await convexRun('testing:seedTrainingClasses', {
    organizationSlug: tenant.slug,
    trainingSlug,
    ...classes,
    placesPerClass: classes.placesPerClass ?? 12,
    registrationDeadline: classes.registrationDeadline ?? classes.firstDate,
  });
}

export interface PublishedTrainingSeed extends TrainingSeed {
  classes: TrainingClassesSeed;
  status?: 'draft' | 'published';
}

/** Skips the rules of `trainings.publish`. Local runs only. */
export async function seedPublishedTraining(
  tenant: Tenant,
  training: PublishedTrainingSeed,
): Promise<string> {
  const { classes, status = 'published', ...fields } = training;
  const slug = await seedTraining(tenant, fields);
  await seedTrainingClasses(tenant, slug, classes);
  if (status === 'published') {
    await convexRun('testing:publishSeededTraining', {
      organizationSlug: tenant.slug,
      trainingSlug: slug,
    });
  }
  return `${tenant.path}/training/${slug}`;
}
