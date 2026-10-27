/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertTenant } from './lib/tenantWrites';
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
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a', cityState: 'Corpus Christi, TX' },
      locations: [],
      leagues: [],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [],
      leagues: [],
    });
    const member = async (
      authUserId: string,
      organization: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organization) {
        await ctx.db.insert('memberships', {
          userId,
          organizationId: organization,
          role,
          leagueIds: [],
        });
      }
    };
    await member('admin-a', a, 'orgAdmin');
    await member('organizer-a', a, 'leagueOrganizer');
    await member('admin-b', b, 'orgAdmin');
    await member('stranger', null, 'orgAdmin');
    return { a, b };
  });
  return { t, ...ids, admin: t.withIdentity(identity('admin-a')) };
}

type T = Awaited<ReturnType<typeof setup>>['t'];

const stored = (t: T, id: Id<'organizations'>) =>
  t.run(async (ctx) => (await ctx.db.get('organizations', id))?.cityState ?? null);

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

describe('organizations.updateDetails', () => {
  test('an org admin sets the City, state, trimmed and collapsed', async () => {
    const { t, a, admin } = await setup();
    await expect(
      admin.mutation(api.organizations.updateDetails, {
        organizationId: a,
        cityState: '  Austin,   TX ',
      }),
    ).resolves.toBeNull();
    expect(await stored(t, a)).toBe('Austin, TX');
  });

  test('null and a blank value remove it, so the organization shows none', async () => {
    const { t, a, admin } = await setup();
    await admin.mutation(api.organizations.updateDetails, { organizationId: a, cityState: null });
    expect(await stored(t, a)).toBeNull();
    await admin.mutation(api.organizations.updateDetails, {
      organizationId: a,
      cityState: 'Austin, TX',
    });
    await admin.mutation(api.organizations.updateDetails, { organizationId: a, cityState: '  ' });
    expect(await stored(t, a)).toBeNull();
    await expect(
      t.query(api.organizations.getPublicPage, { slug: 'org-a' }),
    ).resolves.not.toHaveProperty('cityState');
  });

  test('refuses 1 and 61 characters with the message, and changes nothing', async () => {
    const { t, a, admin } = await setup();
    for (const cityState of ['X', 'c'.repeat(61)]) {
      const data = await refusal(
        admin.mutation(api.organizations.updateDetails, { organizationId: a, cityState }),
      );
      expect(data).toEqual({
        field: 'cityState',
        code: 'cityStateInvalid',
        message: 'Use 2 to 60 characters, such as Corpus Christi, TX.',
      });
    }
    expect(await stored(t, a)).toBe('Corpus Christi, TX');
  });

  test('refuses a league organizer, an org admin of another organization, a non-member, an identity with no users row, and the unauthenticated, and changes nothing', async () => {
    const { t, a } = await setup();
    const refused = [
      ['organizer-a', 'Not allowed'],
      ['admin-b', 'Not allowed'],
      ['stranger', 'Not allowed'],
      ['ghost', 'Sign in required'],
      [null, 'Sign in required'],
    ] as const;
    for (const [caller, message] of refused) {
      const client = caller === null ? t : t.withIdentity(identity(caller));
      await expect(
        client.mutation(api.organizations.updateDetails, {
          organizationId: a,
          cityState: 'Austin, TX',
        }),
        String(caller),
      ).rejects.toThrow(message);
    }
    expect(await stored(t, a)).toBe('Corpus Christi, TX');
  });

  test('does not touch another organization', async () => {
    const { t, a, b, admin } = await setup();
    await admin.mutation(api.organizations.updateDetails, {
      organizationId: a,
      cityState: 'Austin, TX',
    });
    expect(await stored(t, b)).toBeNull();
  });
});

describe('the City, state on the pages', () => {
  test('the public page returns it when set and omits it when not', async () => {
    const { t } = await setup();
    await expect(
      t.query(api.organizations.getPublicPage, { slug: 'org-a' }),
    ).resolves.toMatchObject({ cityState: 'Corpus Christi, TX' });
    await expect(
      t.query(api.organizations.getPublicPage, { slug: 'org-b' }),
    ).resolves.not.toHaveProperty('cityState');
  });

  test('the admin context returns it to an org admin', async () => {
    const { a, admin } = await setup();
    await expect(
      admin.query(api.organizations.getAdminContext, { slug: 'org-a' }),
    ).resolves.toEqual({
      organizationId: a,
      name: 'Org A',
      slug: 'org-a',
      cityState: 'Corpus Christi, TX',
    });
  });
});
