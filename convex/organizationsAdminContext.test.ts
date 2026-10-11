/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import { FORBIDDEN_CODE, isForbidden } from './lib/forbidden';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

// `organizations.getAdminContext` (#65): the query the admin area asks before anything else.

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
  const organizationId = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
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
      organization: typeof a | null,
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
    return a;
  });
  return { t, organizationId };
}

/** The error a call throws, or `null`. */
async function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => null,
    (e: unknown) => e,
  );
}

describe('organizations.getAdminContext', () => {
  test('gives an org admin the organization id, name, and slug', async () => {
    const { t, organizationId } = await setup();
    await expect(
      t.withIdentity(identity('admin-a')).query(api.organizations.getAdminContext, {
        slug: 'org-a',
      }),
    ).resolves.toEqual({ organizationId, name: 'Org A', slug: 'org-a' });
  });

  test('throws FORBIDDEN for a league organizer, an org admin of another organization, a non-member, an identity with no users row, and the unauthenticated', async () => {
    const { t } = await setup();
    const callers = ['organizer-a', 'admin-b', 'stranger', 'ghost', null];
    for (const caller of callers) {
      const run = caller ? t.withIdentity(identity(caller)) : t;
      const error = await failure(run.query(api.organizations.getAdminContext, { slug: 'org-a' }));
      expect(isForbidden(error), String(caller)).toBe(true);
    }
    expect(FORBIDDEN_CODE).toBe('FORBIDDEN');
  });

  test('returns null for an unknown slug, whoever asks', async () => {
    const { t } = await setup();
    for (const slug of ['does-not-exist', 'Not A Slug', '', 'new']) {
      for (const caller of ['admin-a', 'stranger', null]) {
        const run = caller ? t.withIdentity(identity(caller)) : t;
        await expect(
          run.query(api.organizations.getAdminContext, { slug }),
          `${slug} / ${String(caller)}`,
        ).resolves.toBeNull();
      }
    }
  });

  test('gives an org admin of B only B, and FORBIDDEN for A', async () => {
    const { t } = await setup();
    const admin = t.withIdentity(identity('admin-b'));
    await expect(
      admin.query(api.organizations.getAdminContext, { slug: 'org-b' }),
    ).resolves.toMatchObject({ slug: 'org-b' });
    expect(
      isForbidden(await failure(admin.query(api.organizations.getAdminContext, { slug: 'org-a' }))),
    ).toBe(true);
  });
});
