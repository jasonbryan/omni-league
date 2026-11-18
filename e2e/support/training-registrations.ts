import { convexRun } from './convex';
import type { Tenant } from './tenant';
import type { TestUser } from './users';

export type TrainingParticipant = { kind: 'self' } | { kind: 'minor'; minorName: string };

/**
 * Skips the rules of registering, the places included. The series takes a place in every class; `date` names the one class instead.
 * Local runs only. `user` must already have an account (`seedUser`).
 */
export async function seedTrainingRegistration(
  tenant: Tenant,
  trainingSlug: string,
  user: TestUser,
  participant: TrainingParticipant,
  date?: string,
): Promise<void> {
  await convexRun('testing:seedTrainingRegistration', {
    organizationSlug: tenant.slug,
    trainingSlug,
    email: user.email,
    participant,
    ...(date !== undefined && { date }),
  });
}

/** Skips the rules of joining, the places included, so a series can wait with places free. Local runs only. `user` must already have an account (`seedUser`). */
export async function seedTrainingWaitlistEntry(
  tenant: Tenant,
  trainingSlug: string,
  user: TestUser,
  participant: TrainingParticipant,
): Promise<void> {
  await convexRun('testing:seedTrainingWaitlistEntry', {
    organizationSlug: tenant.slug,
    trainingSlug,
    email: user.email,
    participant,
  });
}
