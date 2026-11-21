import { convexRun } from './convex';
import type { Tenant } from './tenant';
import type { TestUser } from './users';

export type CampParticipant = { kind: 'self' } | { kind: 'minor'; minorName: string };

/** Local runs only. `user` must already have an account (`seedUser`). */
export async function seedCampRegistration(
  tenant: Tenant,
  campSlug: string,
  sessionName: string,
  user: TestUser,
  participant: CampParticipant,
): Promise<void> {
  await convexRun('testing:seedCampRegistration', {
    organizationSlug: tenant.slug,
    campSlug,
    sessionName,
    email: user.email,
    participant,
  });
}

/** One transaction for all participants, so a big session does not conflict with itself. Local runs only. `user` must already have an account (`seedUser`). */
export async function seedCampRegistrations(
  tenant: Tenant,
  campSlug: string,
  sessionName: string,
  user: TestUser,
  participants: CampParticipant[],
): Promise<void> {
  await convexRun('testing:seedCampRegistrations', {
    organizationSlug: tenant.slug,
    campSlug,
    sessionName,
    email: user.email,
    participants,
  });
}

/** Skips the rules of joining, the places included. Local runs only. `user` must already have an account (`seedUser`). */
export async function seedCampWaitlistEntry(
  tenant: Tenant,
  campSlug: string,
  sessionName: string,
  user: TestUser,
  participant: CampParticipant,
): Promise<void> {
  await convexRun('testing:seedCampWaitlistEntry', {
    organizationSlug: tenant.slug,
    campSlug,
    sessionName,
    email: user.email,
    participant,
  });
}
