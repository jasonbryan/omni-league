/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TRAINING_MESSAGES, trainingAgesLabel } from './lib/trainingInput';
import {
  defaultDivision,
  insertDraftCamp,
  insertDraftTournament,
  insertTenant,
} from './lib/tenantWrites';
import schema from './schema';
import { modules, tournamentProgramFields } from './test.setup';
import { ADMIN_TRAININGS_LIMIT } from './trainings';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const organizationA = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [
        { name: 'bravo Beach', address: '2 Bravo St' },
        { name: 'Alpha Field', address: '1 Alpha St' },
      ],
      leagues: [
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: defaultDivision('soccer'),
        },
      ],
    });
    const organizationB = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Field', address: '9 B St' }],
      leagues: [],
    });
    const locationIn = async (organizationId: Id<'organizations'>, name: string) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) =>
          q.eq('organizationId', organizationId).eq('name', name),
        )
        .unique())!._id;
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds: [] });
      }
    };
    await member('admin-a', organizationA);
    await member('organizer-a', organizationA, 'leagueOrganizer');
    await member('admin-b', organizationB);
    await member('stranger', null);
    return {
      organizationA,
      organizationB,
      alpha: await locationIn(organizationA, 'Alpha Field'),
      bravo: await locationIn(organizationA, 'bravo Beach'),
      bField: await locationIn(organizationB, 'B Field'),
    };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const valid = (s: Setup) => ({
  organizationId: s.organizationA,
  name: 'Tuesday Serving Clinic',
  slug: 'tuesday-serving-clinic',
  sport: 'beachVolleyball' as const,
  locationIds: [s.bravo],
  coachName: 'Dana Ruiz',
});

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    ['league organizer of A', s.t.withIdentity(identity('organizer-a')), 'Not allowed'],
    ['org admin of B', s.adminB, 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    trainings: await ctx.db.query('trainings').collect(),
    programs: await ctx.db.query('programs').collect(),
    leagues: await ctx.db.query('leagues').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    sportLocations: await ctx.db.query('sportLocations').collect(),
  }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

describe('trainings.create', () => {
  test('writes a draft training and its program of type training, in the right organization', async () => {
    const s = await setup();
    const { trainingId } = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      locationIds: [s.bravo, s.alpha],
    });
    const { training, program } = await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', trainingId))!;
      return { training, program: await ctx.db.get('programs', training.programId) };
    });
    expect(training).toEqual({
      _id: trainingId,
      _creationTime: training._creationTime,
      programId: program?._id,
      organizationId: s.organizationA,
      status: 'draft',
      sport: 'beachVolleyball',
      coachName: 'Dana Ruiz',
    });
    expect(program).toMatchObject({
      organizationId: s.organizationA,
      type: 'training',
      name: 'Tuesday Serving Clinic',
      sortName: 'tuesday serving clinic',
      slug: 'tuesday-serving-clinic',
      sport: 'beachVolleyball',
      status: 'draft',
      locationIds: [s.bravo, s.alpha],
    });
    expect(program).not.toHaveProperty('leagueId');
  });

  test('gives the program the sport’s default division, which the training does not use', async () => {
    const s = await setup();
    const { trainingId } = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      sport: 'soccer',
    });
    const program = await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', trainingId))!;
      return (await ctx.db.get('programs', training.programId))!;
    });
    expect(program).toMatchObject(defaultDivision('soccer'));
  });

  test('stores only a minimum age, and it is read as 16 or older', async () => {
    const s = await setup();
    const { trainingId } = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      minimumAge: 16,
    });
    const training = await s.t.run((ctx) => ctx.db.get('trainings', trainingId));
    expect(training?.minimumAge).toBe(16);
    expect(training).not.toHaveProperty('maximumAge');
    const [row] = await s.adminA.query(api.trainings.listForOrganization, {
      organizationId: s.organizationA,
    });
    expect(trainingAgesLabel(row?.minimumAge, row?.maximumAge)).toBe('16 or older');
  });

  test('stores only a maximum age, and both ages, and the limits of the range', async () => {
    const s = await setup();
    const only = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      slug: 'under-twelve',
      maximumAge: 12,
    });
    const both = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      slug: 'nine-to-fourteen',
      minimumAge: 9,
      maximumAge: 14,
    });
    const limits = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      slug: 'every-age',
      minimumAge: 4,
      maximumAge: 99,
    });
    const read = (id: Id<'trainings'>) => s.t.run((ctx) => ctx.db.get('trainings', id));
    expect(await read(only.trainingId)).toMatchObject({ maximumAge: 12 });
    expect(await read(only.trainingId)).not.toHaveProperty('minimumAge');
    expect(await read(both.trainingId)).toMatchObject({ minimumAge: 9, maximumAge: 14 });
    expect(await read(limits.trainingId)).toMatchObject({ minimumAge: 4, maximumAge: 99 });
  });

  test('trims the name and the coach and keeps each location once', async () => {
    const s = await setup();
    const { trainingId } = await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      name: '  Tuesday Serving Clinic  ',
      coachName: '  Dana Ruiz ',
      locationIds: [s.bravo, s.bravo],
    });
    const { training, program } = await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', trainingId))!;
      return { training, program: await ctx.db.get('programs', training.programId) };
    });
    expect(program?.name).toBe('Tuesday Serving Clinic');
    expect(program?.locationIds).toEqual([s.bravo]);
    expect(training.coachName).toBe('Dana Ruiz');
  });

  test('changes no league counter and writes no league, season, tournament, camp, or sportLocations row', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.trainings.create, valid(s));
    const after = await snapshot(s.t);
    expect(after.leagues).toEqual(before.leagues);
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
    expect(await s.t.run((ctx) => ctx.db.query('tournaments').collect())).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.query('camps').collect())).toEqual([]);
  });

  test('refuses ages from 12 to 9 under the age to, with the shared message, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    expect(
      await refusal(
        s.adminA.mutation(api.trainings.create, { ...valid(s), minimumAge: 12, maximumAge: 9 }),
      ),
    ).toEqual({
      field: 'maximumAge',
      code: 'agesReversed',
      message: TRAINING_MESSAGES.agesReversed(12),
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test.each([
    ['an age from of 3', { minimumAge: 3 }, 'minimumAge'],
    ['an age to of 100', { maximumAge: 100 }, 'maximumAge'],
    ['an age from of 9.5', { minimumAge: 9.5 }, 'minimumAge'],
    ['an age to of 3', { maximumAge: 3 }, 'maximumAge'],
    ['an age from that is not a number', { minimumAge: NaN }, 'minimumAge'],
    ['an infinite age to', { maximumAge: Infinity }, 'maximumAge'],
    ['a negative age from', { minimumAge: -5 }, 'minimumAge'],
  ])('refuses %s with the field’s error', async (_label, change, field) => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.trainings.create, { ...valid(s), ...change })),
    ).toMatchObject({ field, code: 'ageInvalid', message: TRAINING_MESSAGES.ageInvalid });
  });

  test('refuses an empty name, one over 100 characters, and a malformed or reserved web address', async () => {
    const s = await setup();
    const code = async (change: object) =>
      (await refusal(s.adminA.mutation(api.trainings.create, { ...valid(s), ...change }))).code;
    expect(await code({ name: '   ' })).toBe('nameEmpty');
    expect(await code({ name: 'x'.repeat(101) })).toBe('nameTooLong');
    expect(await code({ slug: 'Not A Slug' })).toBe('slugInvalid');
    expect(await code({ slug: 'new' })).toBe('slugInvalid');
    expect(await code({ slug: '' })).toBe('slugEmpty');
  });

  test('refuses an empty coach, one over 100 characters, and one with hidden characters', async () => {
    const s = await setup();
    const code = async (coachName: string) =>
      (await refusal(s.adminA.mutation(api.trainings.create, { ...valid(s), coachName }))).code;
    expect(await code('   ')).toBe('coachEmpty');
    expect(await code('x'.repeat(101))).toBe('coachTooLong');
    expect(await code('Dana‮')).toBe('coachInvisible');
    expect(await s.t.run((ctx) => ctx.db.query('trainings').collect())).toEqual([]);
  });

  test('refuses no location, and a location of another organization, alone or among its own', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.trainings.create, { ...valid(s), locationIds: [] })),
    ).toMatchObject({ field: 'locations', code: 'locationsEmpty' });
    for (const locationIds of [[s.bField], [s.bravo, s.bField]]) {
      await expect(
        s.adminA.mutation(api.trainings.create, { ...valid(s), locationIds }),
      ).rejects.toThrow('Not allowed');
    }
    expect(await s.t.run((ctx) => ctx.db.query('trainings').collect())).toEqual([]);
  });

  test('refuses a web address a league of the organization holds, and allows it in another organization', async () => {
    const s = await setup();
    expect(
      await refusal(s.adminA.mutation(api.trainings.create, { ...valid(s), slug: 'coed-7v7' })),
    ).toMatchObject({
      field: 'slug',
      code: 'slugTaken',
      message: 'coed-7v7 is already taken. Choose another web address.',
    });
    await s.adminB.mutation(api.trainings.create, {
      ...valid(s),
      organizationId: s.organizationB,
      locationIds: [s.bField],
      slug: 'coed-7v7',
    });
  });

  test('refuses a web address a tournament, another training, a camp, or any other program of the organization holds', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await insertDraftTournament(ctx, s.organizationA, {
        name: 'Winter Open',
        slug: 'winter-open',
        sport: 'soccer',
        locationIds: [s.alpha],
        division: defaultDivision('soccer'),
        startDate: '2027-01-16',
        endDate: '2027-01-16',
        registrationDeadline: '2027-01-09',
        maximumTeams: 8,
      });
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
      await insertDraftCamp(ctx, s.organizationA, {
        name: 'Fall Break Camp',
        slug: 'fall-break-camp',
        sport: 'beachVolleyball',
        locationIds: [s.alpha],
        minimumAge: 9,
        maximumAge: 14,
      });
    });
    await s.adminA.mutation(api.trainings.create, valid(s));
    const before = await snapshot(s.t);
    for (const slug of [
      'winter-open',
      'summer-open',
      'fall-break-camp',
      'tuesday-serving-clinic',
    ]) {
      expect(
        await refusal(s.adminA.mutation(api.trainings.create, { ...valid(s), slug })),
        slug,
      ).toMatchObject({ field: 'slug', code: 'slugTaken' });
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('a training’s web address is then refused to a tournament, a camp, and a league', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainings.create, valid(s));
    const slug = 'tuesday-serving-clinic';
    const args = { organizationId: s.organizationA, slug };
    expect(await s.adminA.query(api.tournaments.isSlugAvailable, args)).toBe(false);
    expect(await s.adminA.query(api.camps.isSlugAvailable, args)).toBe(false);
    expect(await s.adminA.query(api.leagues.isSlugAvailable, args)).toBe(false);
  });

  test('two creates of the same web address at once leave one training and one refusal', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.adminA.mutation(api.trainings.create, valid(s)),
      s.adminA.mutation(api.trainings.create, { ...valid(s), name: 'Other Name' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await s.t.run((ctx) => ctx.db.query('trainings').collect())).toHaveLength(1);
  });

  test('a training is not a tournament or a camp: their pages and lists do not see it', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainings.create, valid(s));
    expect(
      await s.adminA.query(api.tournaments.getForManagement, {
        orgSlug: 'org-a',
        tournamentSlug: 'tuesday-serving-clinic',
      }),
    ).toBeNull();
    expect(
      await s.adminA.query(api.camps.getForManagement, {
        orgSlug: 'org-a',
        campSlug: 'tuesday-serving-clinic',
      }),
    ).toBeNull();
    expect(
      await s.adminA.query(api.tournaments.listForOrganization, {
        organizationId: s.organizationA,
      }),
    ).toEqual([]);
    expect(
      await s.adminA.query(api.camps.listForOrganization, { organizationId: s.organizationA }),
    ).toEqual([]);
  });

  test('refuses every caller who is not an org admin of the organization, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(caller.mutation(api.trainings.create, valid(s)), label).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });
});

describe('trainings.isSlugAvailable', () => {
  const available = (s: Setup, slug: string) =>
    s.adminA.query(api.trainings.isSlugAvailable, { organizationId: s.organizationA, slug });

  test('is true for a free web address and false for one a league, a training, or another program holds', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainings.create, valid(s));
    await s.t.run(async (ctx) => {
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    expect(await available(s, 'spring-clinic')).toBe(true);
    expect(await available(s, 'coed-7v7')).toBe(false);
    expect(await available(s, 'tuesday-serving-clinic')).toBe(false);
    expect(await available(s, 'summer-open')).toBe(false);
  });

  test('is false for an address no one could choose, and true for the same one in another organization', async () => {
    const s = await setup();
    expect(await available(s, 'new')).toBe(false);
    expect(await available(s, 'ab')).toBe(false);
    expect(
      await s.adminB.query(api.trainings.isSlugAvailable, {
        organizationId: s.organizationB,
        slug: 'coed-7v7',
      }),
    ).toBe(true);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.trainings.isSlugAvailable, {
          organizationId: s.organizationA,
          slug: 'spring-clinic',
        }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

describe('trainings.listForOrganization', () => {
  const list = (s: Setup) =>
    s.adminA.query(api.trainings.listForOrganization, { organizationId: s.organizationA });

  test('lists name, slug, coach, ages, status, and the program id an invite assigns, newest first', async () => {
    const s = await setup();
    const first = await s.adminA.mutation(api.trainings.create, valid(s));
    await s.adminA.mutation(api.trainings.create, {
      ...valid(s),
      name: 'Under 12 Passing',
      slug: 'under-12-passing',
      coachName: 'Lee Park',
      maximumAge: 12,
    });
    const programId = await s.t.run(
      async (ctx) => (await ctx.db.get('trainings', first.trainingId))!.programId,
    );
    const rows = await list(s);
    expect(rows.map((row) => row.name)).toEqual(['Under 12 Passing', 'Tuesday Serving Clinic']);
    expect(rows[0]).toEqual({
      trainingId: rows[0]?.trainingId,
      programId: rows[0]?.programId,
      name: 'Under 12 Passing',
      slug: 'under-12-passing',
      coachName: 'Lee Park',
      maximumAge: 12,
      status: 'draft',
    });
    expect(rows[1]).toEqual({
      trainingId: first.trainingId,
      programId,
      name: 'Tuesday Serving Clinic',
      slug: 'tuesday-serving-clinic',
      coachName: 'Dana Ruiz',
      status: 'draft',
    });
  });

  test('shows a published training as published', async () => {
    const s = await setup();
    const { trainingId } = await s.adminA.mutation(api.trainings.create, valid(s));
    await s.t.run(async (ctx) => {
      const training = (await ctx.db.get('trainings', trainingId))!;
      await ctx.db.patch('programs', training.programId, { status: 'published' });
    });
    expect((await list(s)).map((row) => row.status)).toEqual(['published']);
  });

  test('never returns another organization’s trainings, a camp, a tournament, or a league, and returns [] for none', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainings.create, valid(s));
    expect(
      await s.adminB.query(api.trainings.listForOrganization, {
        organizationId: s.organizationB,
      }),
    ).toEqual([]);
    await s.t.run(async (ctx) => {
      await ctx.db.insert('programs', tournamentProgramFields(s.organizationA, 'summer-open'));
    });
    expect(await list(s)).toHaveLength(1);
  });

  test('reads at most the limit', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let n = 0; n < ADMIN_TRAININGS_LIMIT + 3; n++) {
        const programId = await ctx.db.insert('programs', {
          ...tournamentProgramFields(s.organizationA, `training-${String(n).padStart(3, '0')}`),
          type: 'training',
        });
        await ctx.db.insert('trainings', {
          programId,
          organizationId: s.organizationA,
          coachName: 'Dana Ruiz',
        });
      }
    });
    expect(await list(s)).toHaveLength(ADMIN_TRAININGS_LIMIT);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    await s.adminA.mutation(api.trainings.create, valid(s));
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.trainings.listForOrganization, { organizationId: s.organizationA }),
        label,
      ).rejects.toThrow(message);
    }
  });
});
