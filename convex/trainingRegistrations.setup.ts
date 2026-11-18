import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { expect } from 'vitest';
import type { Id } from './_generated/dataModel';
import type { TrainingPattern } from './lib/trainingPattern';
import {
  insertDraftTraining,
  insertTenant,
  insertTrainingClasses,
  publishTraining,
} from './lib/tenantWrites';
import { insertMembership } from './lib/memberships';
import schema from './schema';
import { modules } from './test.setup';

// Noon UTC on the series deadline, the day before the first class.
export const NOW = Date.UTC(2027, 1, 1, 12, 0, 0);

export const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

export const PATTERN: TrainingPattern = {
  weekday: 2,
  startTime: '18:00',
  endTime: '19:00',
  firstDate: '2027-02-02',
  weeks: 3,
  placesPerClass: 12,
  registrationDeadline: '2027-02-01',
  allowSingleRegistration: false,
};

export const CLASS_DATES = ['2027-02-02', '2027-02-09', '2027-02-16'] as const;

export interface TrainingSpec {
  name: string;
  slug: string;
  ages?: { minimumAge?: number; maximumAge?: number };
  status?: 'published' | 'draft';
  pattern?: Partial<TrainingPattern>;
  scheduled?: boolean;
}

export const TRAININGS: Record<string, TrainingSpec> = {
  open: { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' },
  adults: {
    name: 'Adult Clinic',
    slug: 'adult-clinic',
    ages: { minimumAge: 18, maximumAge: 99 },
  },
  youth: { name: 'Youth Clinic', slug: 'youth-clinic', ages: { minimumAge: 9, maximumAge: 17 } },
  mixed: { name: 'Mixed Clinic', slug: 'mixed-clinic', ages: { minimumAge: 14, maximumAge: 30 } },
  teens: { name: 'Teen Clinic', slug: 'teen-clinic', ages: { maximumAge: 12 } },
  seniors: { name: 'Senior Clinic', slug: 'senior-clinic', ages: { minimumAge: 16 } },
  lastPlace: {
    name: 'Last Place Clinic',
    slug: 'last-place-clinic',
    pattern: { placesPerClass: 1 },
  },
  pastDeadline: {
    name: 'Past Deadline Clinic',
    slug: 'past-deadline-clinic',
    pattern: { registrationDeadline: '2027-01-31' },
  },
  passed: {
    name: 'Passed Clinic',
    slug: 'passed-clinic',
    pattern: { firstDate: '2027-01-05', registrationDeadline: '2027-01-04' },
  },
  dropIn: {
    name: 'Drop-in Clinic',
    slug: 'drop-in-clinic',
    pattern: { allowSingleRegistration: true },
  },
  dropInYouth: {
    name: 'Drop-in Youth Clinic',
    slug: 'drop-in-youth-clinic',
    ages: { minimumAge: 9, maximumAge: 17 },
    pattern: { allowSingleRegistration: true },
  },
  dropInLastPlace: {
    name: 'Drop-in Last Place Clinic',
    slug: 'drop-in-last-place-clinic',
    pattern: { allowSingleRegistration: true, placesPerClass: 1 },
  },
  dropInMidRun: {
    name: 'Drop-in Mid-run Clinic',
    slug: 'drop-in-mid-run-clinic',
    pattern: {
      allowSingleRegistration: true,
      firstDate: '2027-01-26',
      registrationDeadline: '2027-01-25',
    },
  },
  draft: { name: 'Secret Draft Clinic', slug: 'secret-draft-clinic', status: 'draft' },
  unscheduled: { name: 'Unscheduled Clinic', slug: 'unscheduled-clinic', scheduled: false },
};

export async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organization = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Field', address: '1 Alpha St' }],
      leagues: [],
    });
    const otherOrganization = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const location = (await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) =>
        q.eq('organizationId', organization).eq('name', 'Alpha Field'),
      )
      .unique())!._id;
    const trainings: Record<
      string,
      { trainingId: Id<'trainings'>; classIds: Id<'trainingClasses'>[] }
    > = {};
    for (const [key, spec] of Object.entries(TRAININGS)) {
      const trainingId = await insertDraftTraining(ctx, organization, {
        name: spec.name,
        slug: spec.slug,
        sport: 'beachVolleyball',
        locationIds: [location],
        coachName: 'Dana Ruiz',
        ...spec.ages,
      });
      if (spec.scheduled !== false) {
        const training = (await ctx.db.get('trainings', trainingId))!;
        await insertTrainingClasses(ctx, training, { ...PATTERN, ...spec.pattern });
      }
      if ((spec.status ?? 'published') === 'published') {
        await publishTraining(ctx, (await ctx.db.get('trainings', trainingId))!);
      }
      const classes = await ctx.db
        .query('trainingClasses')
        .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId))
        .collect();
      trainings[key] = { trainingId, classIds: classes.map((row) => row._id) };
    }
    const users: Record<string, Id<'users'>> = {};
    for (const name of ['alice', 'bob', 'carol', 'admin']) {
      users[name] = await ctx.db.insert('users', { authUserId: name, name, adultConfirmedAt: 1 });
    }
    await insertMembership(ctx, users['admin'], organization, 'orgAdmin');
    return { organization, otherOrganization, trainings, users };
  });
  return {
    t,
    ...ids,
    alice: t.withIdentity(identity('alice')),
    bob: t.withIdentity(identity('bob')),
    carol: t.withIdentity(identity('carol')),
    admin: t.withIdentity(identity('admin')),
    ghost: t.withIdentity(identity('ghost')),
  };
}

export type Setup = Awaited<ReturnType<typeof setup>>;

export async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string; message: string; field?: string }>).data;
}

export async function registeredCounts(s: Setup, key: string): Promise<number[]> {
  return s.t.run(async (ctx) => {
    const counts: number[] = [];
    for (const id of s.trainings[key].classIds) {
      counts.push((await ctx.db.get('trainingClasses', id))!.registeredCount);
    }
    return counts;
  });
}
