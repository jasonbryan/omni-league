/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { deleteUserRecord } from './lib/users';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.parse('2030-05-20T12:00:00Z');

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const P256DH = base64Url(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i)));
const AUTH = base64Url(new Uint8Array(16).fill(9));
const VAPID_PUBLIC_KEY = base64Url(
  Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 255 - i)),
);

const subscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/device-1') => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: P256DH, auth: AUTH },
});

async function setup() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => ({
    a: await ctx.db.insert('users', { authUserId: 'auth-a', name: 'A', adultConfirmedAt: 0 }),
    b: await ctx.db.insert('users', { authUserId: 'auth-b', name: 'B', adultConfirmedAt: 0 }),
  }));
  return {
    t,
    users,
    a: t.withIdentity(identity('auth-a')),
    b: t.withIdentity(identity('auth-b')),
    rows: () => t.run((ctx) => ctx.db.query('pushSubscriptions').collect()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('push.getConfig', () => {
  test('returns only the public key, to anyone', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', VAPID_PUBLIC_KEY);
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key-never-returned');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:support@example.test');
    const { t } = await setup();

    expect(await t.query(api.push.getConfig, {})).toEqual({ vapidPublicKey: VAPID_PUBLIC_KEY });
  });

  test('returns null when VAPID_PUBLIC_KEY is unset, empty, or not a P-256 public key', async () => {
    const { t } = await setup();
    expect(await t.query(api.push.getConfig, {})).toEqual({ vapidPublicKey: null });
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    expect(await t.query(api.push.getConfig, {})).toEqual({ vapidPublicKey: null });
    vi.stubEnv('VAPID_PUBLIC_KEY', AUTH);
    expect(await t.query(api.push.getConfig, {})).toEqual({ vapidPublicKey: null });
  });
});

describe('push.subscribe', () => {
  test('saves the caller’s subscription with createdAt, lastSeenAt, and no failures', async () => {
    const s = await setup();
    expect(await s.a.mutation(api.push.subscribe, subscription())).toBeNull();

    const [row] = await s.rows();
    expect(row).toMatchObject({
      userId: s.users.a,
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
      p256dh: P256DH,
      auth: AUTH,
      createdAt: NOW,
      lastSeenAt: NOW,
      failureCount: 0,
    });
    expect(row?.expirationTime).toBeUndefined();
    expect(row?.lastSuccessAt).toBeUndefined();
  });

  test('keeps a future expirationTime', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, { ...subscription(), expirationTime: NOW + 1000 });
    expect((await s.rows())[0]?.expirationTime).toBe(NOW + 1000);
  });

  test.each([
    ['unauthenticated', (s: Awaited<ReturnType<typeof setup>>) => s.t],
    [
      'identity with no users row',
      (s: Awaited<ReturnType<typeof setup>>) => s.t.withIdentity(identity('ghost')),
    ],
  ])('%s: fails with Sign in required and writes nothing', async (_case, caller) => {
    const s = await setup();
    await expect(caller(s).mutation(api.push.subscribe, subscription())).rejects.toThrow(
      'Sign in required',
    );
    expect(await s.rows()).toEqual([]);
  });

  test.each([
    ['an http: endpoint', { endpoint: 'http://fcm.googleapis.com/fcm/send/x' }],
    ['a host outside the allow-list', { endpoint: 'https://push.example.com/x' }],
    ['a lookalike host', { endpoint: 'https://fcm.googleapis.com.evil.example/x' }],
    ['a p256dh of 64 bytes', { keys: { p256dh: base64Url(new Uint8Array(64)), auth: AUTH } }],
    ['a p256dh that is not base64url', { keys: { p256dh: `${P256DH.slice(1)}+`, auth: AUTH } }],
    ['an auth of 15 bytes', { keys: { p256dh: P256DH, auth: base64Url(new Uint8Array(15)) } }],
    ['an auth of 17 bytes', { keys: { p256dh: P256DH, auth: base64Url(new Uint8Array(17)) } }],
  ])('refuses %s and writes nothing', async (_case, change) => {
    const s = await setup();
    await expect(
      s.a.mutation(api.push.subscribe, { ...subscription(), ...change }),
    ).rejects.toThrow();
    expect(await s.rows()).toEqual([]);
  });

  test('a refused endpoint leaves an existing row untouched', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    const before = await s.rows();
    await expect(
      s.b.mutation(api.push.subscribe, {
        ...subscription(),
        keys: { p256dh: P256DH, auth: 'short' },
      }),
    ).rejects.toThrow();
    expect(await s.rows()).toEqual(before);
  });

  test('a second subscribe for the same endpoint updates lastSeenAt and the keys, keeping one row', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    vi.setSystemTime(NOW + 60_000);
    const newAuth = base64Url(new Uint8Array(16).fill(3));
    await s.a.mutation(api.push.subscribe, {
      ...subscription(),
      keys: { p256dh: P256DH, auth: newAuth },
    });

    const rows = await s.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ createdAt: NOW, lastSeenAt: NOW + 60_000, auth: newAuth });
  });

  test('B turning on with A’s browser subscription moves the row to B, and A keeps none for it', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    await s.t.run(async (ctx) => {
      const row = await ctx.db.query('pushSubscriptions').first();
      if (row)
        await ctx.db.patch('pushSubscriptions', row._id, { failureCount: 3, lastSuccessAt: NOW });
    });
    vi.setSystemTime(NOW + 1000);
    await s.b.mutation(api.push.subscribe, subscription());

    const rows = await s.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: s.users.b,
      createdAt: NOW + 1000,
      lastSeenAt: NOW + 1000,
      failureCount: 0,
    });
    expect(rows[0]?.lastSuccessAt).toBeUndefined();
    expect(await s.a.query(api.push.getMyDeviceStatus, { endpoint: subscription().endpoint })).toBe(
      false,
    );
    expect(await s.b.query(api.push.getMyDeviceStatus, { endpoint: subscription().endpoint })).toBe(
      true,
    );
  });

  test('an 11th subscription replaces the least recently seen of the user’s 10, and no other user’s', async () => {
    const s = await setup();
    await s.b.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/b-0'));
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(NOW + i * 1000);
      await s.a.mutation(
        api.push.subscribe,
        subscription(`https://fcm.googleapis.com/fcm/send/a-${String(i)}`),
      );
    }
    // Seen again, so a-1 is now the least recently seen.
    vi.setSystemTime(NOW + 20_000);
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-0'));
    vi.setSystemTime(NOW + 30_000);
    await s.a.mutation(
      api.push.subscribe,
      subscription('https://fcm.googleapis.com/fcm/send/a-10'),
    );

    const rows = await s.rows();
    const endpointsOf = (userId: Id<'users'>) =>
      rows
        .filter((row) => row.userId === userId)
        .map((row) => row.endpoint.split('/').pop())
        .sort();
    expect(endpointsOf(s.users.a)).toEqual(
      ['a-0', 'a-10', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7', 'a-8', 'a-9'].sort(),
    );
    expect(endpointsOf(s.users.b)).toEqual(['b-0']);
  });
});

describe('push.subscribe edge cases', () => {
  test('signed out with an invalid subscription: fails with Sign in required, not a validation error', async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.push.subscribe, { ...subscription('http://evil.example/x') }),
    ).rejects.toThrow('Sign in required');
    expect(await s.rows()).toEqual([]);
  });

  test.each([
    ['endpoint', { endpoint: 'https://fcm.googleapis.com@evil.example/x' }],
    ['p256dh', { keys: { p256dh: base64Url(new Uint8Array(65)), auth: AUTH } }],
    ['auth', { keys: { p256dh: P256DH, auth: `${AUTH}==` } }],
  ])('names the refused field %s in a pushSubscriptionInvalid error', async (field, change) => {
    const s = await setup();
    const error: unknown = await s.a
      .mutation(api.push.subscribe, { ...subscription(), ...change })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ data: { code: 'pushSubscriptionInvalid', field } });
    expect(await s.rows()).toEqual([]);
  });

  test('a refused subscription for A’s endpoint, sent by B, leaves A’s row with A', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    await expect(
      s.b.mutation(api.push.subscribe, {
        ...subscription(),
        keys: { p256dh: base64Url(new Uint8Array(64)), auth: AUTH },
      }),
    ).rejects.toThrow();
    expect((await s.rows()).map((row) => row.userId)).toEqual([s.users.a]);
  });

  test('A and B subscribing the same endpoint at once leave exactly one row', async () => {
    const s = await setup();
    await Promise.all([
      s.a.mutation(api.push.subscribe, subscription()),
      s.b.mutation(api.push.subscribe, subscription()),
      s.a.mutation(api.push.subscribe, subscription()),
    ]);
    expect(await s.rows()).toHaveLength(1);
  });

  test('eleven subscriptions at once leave the user ten rows', async () => {
    const s = await setup();
    await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        s.a.mutation(
          api.push.subscribe,
          subscription(`https://fcm.googleapis.com/fcm/send/p-${String(i)}`),
        ),
      ),
    );
    expect(await s.rows()).toHaveLength(10);
  });

  test('moving the endpoint to B at B’s cap replaces B’s least recently seen, and A loses only that row', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-0'));
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-1'));
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(NOW + (i + 1) * 1000);
      await s.b.mutation(
        api.push.subscribe,
        subscription(`https://fcm.googleapis.com/fcm/send/b-${String(i)}`),
      );
    }
    vi.setSystemTime(NOW + 60_000);
    await s.b.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-0'));

    const rows = await s.rows();
    const endpointsOf = (userId: Id<'users'>) =>
      rows
        .filter((row) => row.userId === userId)
        .map((row) => row.endpoint.split('/').pop())
        .sort();
    expect(endpointsOf(s.users.a)).toEqual(['a-1']);
    expect(endpointsOf(s.users.b)).toHaveLength(10);
    expect(endpointsOf(s.users.b)).toContain('a-0');
    expect(endpointsOf(s.users.b)).not.toContain('b-0');
  });
});

describe('push.unsubscribe', () => {
  test('removes only the caller’s row for that endpoint, leaving the caller’s others and other users’', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-1'));
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-2'));
    await s.b.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/b-1'));

    await s.a.mutation(api.push.unsubscribe, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/a-1',
    });

    expect((await s.rows()).map((row) => row.endpoint.split('/').pop()).sort()).toEqual([
      'a-2',
      'b-1',
    ]);
  });

  test('deletes the caller’s own row', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    expect(
      await s.a.mutation(api.push.unsubscribe, { endpoint: subscription().endpoint }),
    ).toBeNull();
    expect(await s.rows()).toEqual([]);
  });

  test('another user’s endpoint: does nothing and answers as for an unknown one', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    const before = await s.rows();

    expect(
      await s.b.mutation(api.push.unsubscribe, { endpoint: subscription().endpoint }),
    ).toBeNull();
    expect(
      await s.b.mutation(api.push.unsubscribe, {
        endpoint: 'https://fcm.googleapis.com/fcm/send/unknown',
      }),
    ).toBeNull();
    expect(await s.b.mutation(api.push.unsubscribe, { endpoint: 'not a url' })).toBeNull();
    expect(await s.rows()).toEqual(before);
  });

  test('unauthenticated: fails with Sign in required and deletes nothing', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    await expect(
      s.t.mutation(api.push.unsubscribe, { endpoint: subscription().endpoint }),
    ).rejects.toThrow('Sign in required');
    expect(await s.rows()).toHaveLength(1);
  });
});

describe('push.getMyDeviceStatus', () => {
  test('true only for the caller’s own row', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription());
    const args = { endpoint: subscription().endpoint };

    expect(await s.a.query(api.push.getMyDeviceStatus, args)).toBe(true);
    expect(await s.b.query(api.push.getMyDeviceStatus, args)).toBe(false);
    expect(
      await s.a.query(api.push.getMyDeviceStatus, {
        endpoint: 'https://fcm.googleapis.com/fcm/send/unknown',
      }),
    ).toBe(false);
  });

  test('unauthenticated: fails with Sign in required', async () => {
    const s = await setup();
    await expect(
      s.t.query(api.push.getMyDeviceStatus, { endpoint: subscription().endpoint }),
    ).rejects.toThrow('Sign in required');
  });
});

describe('deleting a user', () => {
  test('deletes that user’s subscriptions only', async () => {
    const s = await setup();
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-1'));
    await s.a.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/a-2'));
    await s.b.mutation(api.push.subscribe, subscription('https://fcm.googleapis.com/fcm/send/b-1'));

    await s.t.run((ctx) => deleteUserRecord(ctx, 'auth-a'));

    expect((await s.rows()).map((row) => row.userId)).toEqual([s.users.b]);
  });
});
