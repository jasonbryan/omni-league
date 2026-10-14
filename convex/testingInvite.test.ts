/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { hashInviteToken } from './lib/inviteToken';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Field', address: '1 Test Road' }],
      leagues: [{ name: 'Coed 7v7', sport: 'soccer', locations: ['Field'] }],
    });
  });
  return t;
}

const INVITE = {
  organizationSlug: 'org-a',
  email: 'Late@Example.com',
  role: 'leagueOrganizer' as const,
  leagueNames: ['Coed 7v7'],
  expiresAt: 1_000,
};

describe('testing:addInvite', () => {
  test.each([undefined, 'false', 'TRUE', ''])(
    'throws with IS_TEST %j and writes nothing',
    async (value) => {
      vi.stubEnv('IS_TEST', value);
      const t = await setup();
      await expect(t.mutation(internal.testing.addInvite, INVITE)).rejects.toThrow(/IS_TEST/);
      expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
    },
  );

  test('adds a pending invite with the given expiry and a hash that matches no token', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await t.mutation(internal.testing.addInvite, INVITE);
    const rows = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'late@example.com',
      role: 'leagueOrganizer',
      status: 'pending',
      expiresAt: 1_000,
    });
    expect(rows[0].leagueIds).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('with a token, its hash is stored, so the token opens the invite (#70 e2e)', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    const token = 'e2e-token_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    await t.mutation(internal.testing.addInvite, {
      ...INVITE,
      expiresAt: Date.now() + 60_000,
      token,
    });
    const rows = await t.run((ctx) => ctx.db.query('invites').collect());
    expect(rows[0]?.tokenHash).toBe(await hashInviteToken(token));
    expect(await t.query(api.invites.getByToken, { token })).toMatchObject({
      status: 'valid',
      organizationName: 'Org A',
      leagueNames: ['Coed 7v7'],
    });
  });

  test('refuses an unknown organization or league', async () => {
    vi.stubEnv('IS_TEST', 'true');
    const t = await setup();
    await expect(
      t.mutation(internal.testing.addInvite, { ...INVITE, organizationSlug: 'nope' }),
    ).rejects.toThrow(/No organization/);
    await expect(
      t.mutation(internal.testing.addInvite, { ...INVITE, leagueNames: ['Missing'] }),
    ).rejects.toThrow(/No league/);
    expect(await t.run((ctx) => ctx.db.query('invites').collect())).toEqual([]);
  });
});
