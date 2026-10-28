/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
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
  await t.run(async (ctx) => {
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
  });
  return t;
}

describe('organizations.viewerIsOrgAdmin', () => {
  test('is true for an org admin of the organization', async () => {
    const t = await setup();
    await expect(
      t
        .withIdentity(identity('admin-a'))
        .query(api.organizations.viewerIsOrgAdmin, { slug: 'org-a' }),
    ).resolves.toBe(true);
  });

  test('is false for a league organizer of it, an org admin of another organization, a non-member, an identity with no users row, and the unauthenticated', async () => {
    const t = await setup();
    for (const caller of ['organizer-a', 'admin-b', 'stranger', 'ghost', null]) {
      const run = caller ? t.withIdentity(identity(caller)) : t;
      await expect(
        run.query(api.organizations.viewerIsOrgAdmin, { slug: 'org-a' }),
        String(caller),
      ).resolves.toBe(false);
    }
  });

  test('is false for an unknown slug, whoever asks', async () => {
    const t = await setup();
    for (const slug of ['does-not-exist', 'Not A Slug', '', 'new']) {
      await expect(
        t.withIdentity(identity('admin-a')).query(api.organizations.viewerIsOrgAdmin, { slug }),
        slug,
      ).resolves.toBe(false);
      await expect(t.query(api.organizations.viewerIsOrgAdmin, { slug })).resolves.toBe(false);
    }
  });
});
