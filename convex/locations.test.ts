/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertLocation, insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

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
      leagues: [{ name: 'Sand 2s', sport: 'beachVolleyball', locations: ['bravo Beach'] }],
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

const snapshot = (t: Setup['t']) =>
  t.run(async (ctx) => ({
    locations: await ctx.db.query('locations').collect(),
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

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    ['league organizer of A', s.t.withIdentity(identity('organizer-a')), 'Not allowed'],
    ['org admin of B', s.adminB, 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

describe('locations.listForAdmin', () => {
  test("lists the organization's locations by name ignoring case, with ids", async () => {
    const s = await setup();
    const rows = await s.adminA.query(api.locations.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(rows).toEqual([
      { locationId: s.alpha, name: 'Alpha Field', address: '1 Alpha St' },
      { locationId: s.bravo, name: 'bravo Beach', address: '2 Bravo St' },
    ]);
  });

  test('returns [] for an organization with no locations, and never another organization’s rows', async () => {
    const s = await setup();
    const empty = await s.t.run((ctx) =>
      ctx.db.insert('organizations', { name: 'Empty', slug: 'empty-org' }),
    );
    const admin = s.t.withIdentity(identity('empty-admin'));
    await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        authUserId: 'empty-admin',
        name: 'x',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId: empty,
        role: 'orgAdmin',
        leagueIds: [],
      });
    });
    await expect(
      admin.query(api.locations.listForAdmin, { organizationId: empty }),
    ).resolves.toEqual([]);
    const own = await s.adminB.query(api.locations.listForAdmin, {
      organizationId: s.organizationB,
    });
    expect(own.map((row) => row.name)).toEqual(['B Field']);
  });

  test('refuses every caller who is not an org admin of the organization', async () => {
    const s = await setup();
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.query(api.locations.listForAdmin, { organizationId: s.organizationA }),
        label,
      ).rejects.toThrow(message);
    }
  });
});

describe('locations.create', () => {
  test('inserts the trimmed location with its sortName and adds 1 to locationCount', async () => {
    const s = await setup();
    const { locationId } = await s.adminA.mutation(api.locations.create, {
      organizationId: s.organizationA,
      name: '  Charlie Courts ',
      address: ' 3 Charlie St ',
    });
    const after = await s.t.run(async (ctx) => ({
      location: await ctx.db.get('locations', locationId),
      organization: await ctx.db.get('organizations', s.organizationA),
    }));
    expect(after.location).toMatchObject({
      organizationId: s.organizationA,
      name: 'Charlie Courts',
      address: '3 Charlie St',
      sortName: 'charlie courts',
    });
    expect(after.organization?.locationCount).toBe(3);
  });

  test('leaves the sport counters and sportLocations rows alone', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.locations.create, {
      organizationId: s.organizationA,
      name: 'Delta',
      address: '4 Delta St',
    });
    const after = await snapshot(s.t);
    expect(after.sportLocations).toEqual(before.sportLocations);
    const [organization] = after.organizations.filter((o) => o._id === s.organizationA);
    expect(organization).toMatchObject({
      sportLeagueCounts: { beachVolleyball: 1 },
      sportLocationCounts: { beachVolleyball: 1 },
      leagueCount: 1,
    });
  });

  test('shows on the public page in sorted order, and in the admin list', async () => {
    const s = await setup();
    await s.adminA.mutation(api.locations.create, {
      organizationId: s.organizationA,
      name: 'Aardvark Park',
      address: '0 Start St',
    });
    const publicList = await s.t.query(api.organizations.listPublicLocations, {
      slug: 'org-a',
      page: 1,
    });
    expect(publicList.total).toBe(3);
    expect(publicList.rows.map((r) => r.name)).toEqual([
      'Aardvark Park',
      'Alpha Field',
      'bravo Beach',
    ]);
    const header = await s.t.query(api.organizations.getPublicPage, { slug: 'org-a' });
    expect(header?.locationCount).toBe(3);
    const admin = await s.adminA.query(api.locations.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(admin).toHaveLength(3);
  });

  test('refuses an empty or whitespace-only name or address, naming the field, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    const cases = [
      { name: '', address: 'ok', field: 'name', code: 'nameEmpty' },
      { name: '   ', address: 'ok', field: 'name', code: 'nameEmpty' },
      { name: 'ok', address: '', field: 'address', code: 'addressEmpty' },
      { name: 'ok', address: ' \t\n', field: 'address', code: 'addressEmpty' },
    ];
    for (const { name, address, field, code } of cases) {
      const data = await refusal(
        s.adminA.mutation(api.locations.create, { organizationId: s.organizationA, name, address }),
      );
      expect(data).toMatchObject({ field, code });
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses a name over 100 characters and an address over 200, with the mockup text', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await expect(
      refusal(
        s.adminA.mutation(api.locations.create, {
          organizationId: s.organizationA,
          name: 'n'.repeat(101),
          address: 'ok',
        }),
      ),
    ).resolves.toEqual({
      field: 'name',
      code: 'nameTooLong',
      message: 'Use 100 characters or fewer. This name has 101.',
    });
    await expect(
      refusal(
        s.adminA.mutation(api.locations.create, {
          organizationId: s.organizationA,
          name: 'ok',
          address: 'a'.repeat(201),
        }),
      ),
    ).resolves.toEqual({
      field: 'address',
      code: 'addressTooLong',
      message: 'Use 200 characters or fewer. This address has 201.',
    });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('accepts exactly 100 and 200 characters', async () => {
    const s = await setup();
    await s.adminA.mutation(api.locations.create, {
      organizationId: s.organizationA,
      name: 'n'.repeat(100),
      address: 'a'.repeat(200),
    });
    const rows = await s.adminA.query(api.locations.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(rows).toHaveLength(3);
  });

  test('reports the name first when both fields are invalid', async () => {
    const s = await setup();
    const data = await refusal(
      s.adminA.mutation(api.locations.create, {
        organizationId: s.organizationA,
        name: '',
        address: '',
      }),
    );
    expect(data).toMatchObject({ field: 'name' });
  });

  test('refuses every caller who is not an org admin of the organization, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.locations.create, {
          organizationId: s.organizationA,
          name: 'Intruder',
          address: 'Nowhere',
        }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('checks access before the input: a refused caller learns nothing about the rules', async () => {
    const s = await setup();
    await expect(
      s.adminB.mutation(api.locations.create, {
        organizationId: s.organizationA,
        name: '',
        address: '',
      }),
    ).rejects.toThrow('Not allowed');
  });
});

describe('locations.update', () => {
  test('renames, changes the address, and updates sortName, leaving the counters alone', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await s.adminA.mutation(api.locations.update, {
      locationId: s.bravo,
      name: ' Zulu Beach ',
      address: ' 26 Zulu St ',
    });
    const after = await snapshot(s.t);
    const stored = after.locations.find((l) => l._id === s.bravo);
    expect(stored).toMatchObject({
      organizationId: s.organizationA,
      name: 'Zulu Beach',
      address: '26 Zulu St',
      sortName: 'zulu beach',
    });
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
    expect(after.locations.filter((l) => l._id !== s.bravo)).toEqual(
      before.locations.filter((l) => l._id !== s.bravo),
    );
  });

  test('a rename re-sorts the public list and the admin list', async () => {
    const s = await setup();
    await s.adminA.mutation(api.locations.update, {
      locationId: s.alpha,
      name: 'Zulu Field',
      address: '1 Alpha St',
    });
    const publicList = await s.t.query(api.organizations.listPublicLocations, {
      slug: 'org-a',
      page: 1,
    });
    expect(publicList.rows.map((r) => r.name)).toEqual(['bravo Beach', 'Zulu Field']);
    const admin = await s.adminA.query(api.locations.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(admin.map((r) => r.name)).toEqual(['bravo Beach', 'Zulu Field']);
  });

  test('a league at the location still names it under its new name', async () => {
    const s = await setup();
    await s.adminA.mutation(api.locations.update, {
      locationId: s.bravo,
      name: 'Renamed Beach',
      address: '2 Bravo St',
    });
    const leagues = await s.t.query(api.organizations.listPublicLeagues, {
      slug: 'org-a',
      page: 1,
    });
    expect(leagues.rows[0]?.locationNames).toEqual(['Renamed Beach']);
  });

  test('refuses invalid input like create, and writes nothing', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await expect(
      refusal(
        s.adminA.mutation(api.locations.update, { locationId: s.alpha, name: '  ', address: 'x' }),
      ),
    ).resolves.toMatchObject({ field: 'name', code: 'nameEmpty' });
    await expect(
      refusal(
        s.adminA.mutation(api.locations.update, {
          locationId: s.alpha,
          name: 'x',
          address: 'a'.repeat(201),
        }),
      ),
    ).resolves.toMatchObject({ field: 'address', code: 'addressTooLong' });
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses every caller who is not an org admin of the location’s organization', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    for (const [label, caller, message] of refusedCallers(s)) {
      await expect(
        caller.mutation(api.locations.update, {
          locationId: s.alpha,
          name: 'Hijacked',
          address: 'Elsewhere',
        }),
        label,
      ).rejects.toThrow(message);
    }
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('refuses an org admin of A who names a location of organization B', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await expect(
      s.adminA.mutation(api.locations.update, {
        locationId: s.bField,
        name: 'Taken Over',
        address: 'A St',
      }),
    ).rejects.toThrow('Not allowed');
    expect(await snapshot(s.t)).toEqual(before);
  });

  test('takes the organization from the stored location: an organizationId argument is refused', async () => {
    const s = await setup();
    await expect(
      s.adminA.mutation(api.locations.update, {
        locationId: s.bField,
        organizationId: s.organizationA,
        name: 'Taken Over',
        address: 'A St',
      } as never),
    ).rejects.toThrow();
    const stored = await s.t.run((ctx) => ctx.db.get('locations', s.bField));
    expect(stored?.name).toBe('B Field');
    expect(stored?.organizationId).toBe(s.organizationB);
  });

  test('refuses a location that no longer exists', async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete('locations', s.alpha));
    await expect(
      s.adminA.mutation(api.locations.update, {
        locationId: s.alpha,
        name: 'Ghost',
        address: 'Nowhere',
      }),
    ).rejects.toThrow('Not allowed');
  });
});

describe('locations edge cases', () => {
  test('allows two locations with the same name in one organization, each its own row and count', async () => {
    const s = await setup();
    const input = { organizationId: s.organizationA, name: 'Twin Courts', address: '5 Twin St' };
    const first = await s.adminA.mutation(api.locations.create, input);
    const second = await s.adminA.mutation(api.locations.create, input);
    expect(second.locationId).not.toBe(first.locationId);
    const rows = await s.adminA.query(api.locations.listForAdmin, {
      organizationId: s.organizationA,
    });
    expect(rows.filter((row) => row.name === 'Twin Courts')).toHaveLength(2);
    const organization = await s.t.run((ctx) => ctx.db.get('organizations', s.organizationA));
    expect(organization?.locationCount).toBe(4);
    const publicList = await s.t.query(api.organizations.listPublicLocations, {
      slug: 'org-a',
      page: 1,
    });
    expect(publicList.total).toBe(4);
  });

  test('listForAdmin returns at most 200 rows, the first 200 by name', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 205; i += 1) {
        await insertLocation(ctx, s.organizationB, {
          name: `Field ${String(i).padStart(3, '0')}`,
          address: `${i} Row St`,
        });
      }
    });
    const rows = await s.adminB.query(api.locations.listForAdmin, {
      organizationId: s.organizationB,
    });
    expect(rows).toHaveLength(200);
    expect(rows[0]?.name).toBe('B Field');
    expect(rows.map((row) => row.name)).toEqual(
      [...rows.map((row) => row.name)].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      ),
    );
  });

  test('two edits of one location in turn leave the last one stored and every counter unchanged', async () => {
    const s = await setup();
    const before = await snapshot(s.t);
    await Promise.all([
      s.adminA.mutation(api.locations.update, {
        locationId: s.alpha,
        name: 'First Edit',
        address: '1 First St',
      }),
      s.adminA.mutation(api.locations.update, {
        locationId: s.alpha,
        name: 'Second Edit',
        address: '2 Second St',
      }),
    ]);
    const after = await snapshot(s.t);
    const stored = after.locations.find((l) => l._id === s.alpha);
    expect(['first edit', 'second edit']).toContain(stored?.sortName);
    expect(stored?.sortName).toBe(stored?.name.toLowerCase());
    expect(after.organizations).toEqual(before.organizations);
    expect(after.sportLocations).toEqual(before.sportLocations);
  });

  test('a rejected update by another organization admin leaves the stored name', async () => {
    const s = await setup();
    await expect(
      s.adminB.mutation(api.locations.update, {
        locationId: s.alpha,
        name: 'Hijacked',
        address: 'X',
      }),
    ).rejects.toThrow('Not allowed');
    const stored = await s.t.run((ctx) => ctx.db.get('locations', s.alpha));
    expect(stored?.name).toBe('Alpha Field');
  });
});
