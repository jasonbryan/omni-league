import { convexTest } from 'convex-test';
import { getFunctionName } from 'convex/server';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';
import * as users from './users';

const asUser = (authUserId: string, name: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name,
  sessionId: 's1',
});

async function seedUsers() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { authUserId: 'auth-a', name: 'Alice A', adultConfirmedAt: 1 });
    await ctx.db.insert('users', { authUserId: 'auth-b', name: 'Bob B', adultConfirmedAt: 2 });
  });
  return t;
}

describe('users.me', () => {
  test('returns null with no identity', async () => {
    const t = await seedUsers();
    await expect(t.query(api.users.me, {})).resolves.toBeNull();
  });

  test("returns each caller's own name, and only the name", async () => {
    const t = await seedUsers();
    await expect(
      t.withIdentity(asUser('auth-a', 'Token Name A')).query(api.users.me, {}),
    ).resolves.toEqual({ name: 'Alice A' });
    await expect(
      t.withIdentity(asUser('auth-b', 'Token Name B')).query(api.users.me, {}),
    ).resolves.toEqual({ name: 'Bob B' });
  });

  test('returns null for an identity with no users row', async () => {
    const t = await seedUsers();
    await expect(
      t.withIdentity(asUser('auth-unknown', 'Nobody')).query(api.users.me, {}),
    ).resolves.toBeNull();
  });

  test('takes no argument, so no caller can name another user', async () => {
    expect(getFunctionName(api.users.me)).toBe('users:me');
    const exported = users.me as unknown as { exportArgs(): string; isPublic?: boolean };
    expect(JSON.parse(exported.exportArgs())).toEqual({ type: 'object', value: {} });
    expect(exported.isPublic).toBe(true);
    const t = await seedUsers();
    await expect(
      t
        .withIdentity(asUser('auth-a', 'A'))
        .query(api.users.me, { authUserId: 'auth-b' } as unknown as Record<string, never>),
    ).rejects.toThrow(/authUserId/);
  });
});
