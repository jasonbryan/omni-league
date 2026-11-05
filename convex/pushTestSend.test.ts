/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TEST_SEND_LIMIT, TEST_SEND_WINDOW_MS } from './lib/pushTestSend';
import {
  decryptPushBody,
  makeBrowserSubscription,
  makeVapidPair,
  type BrowserSubscription,
} from './lib/pushTestKit';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.parse('2030-05-20T12:00:00Z');
const MINUTE_MS = 60 * 1000;

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const vapid = await makeVapidPair();
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:support@example.test');
  vi.stubEnv('SITE_URL', 'https://staging.example.test');
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 201 })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => ({
    a: await ctx.db.insert('users', { authUserId: 'auth-a', name: 'A', adultConfirmedAt: 0 }),
    b: await ctx.db.insert('users', { authUserId: 'auth-b', name: 'B', adultConfirmedAt: 0 }),
  }));
  const browsers = new Map<string, BrowserSubscription>();
  async function addDevice(userId: Id<'users'>, name: string) {
    const browser = await makeBrowserSubscription();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${name}`;
    browsers.set(endpoint, browser);
    await t.run((ctx) =>
      ctx.db.insert('pushSubscriptions', {
        userId,
        endpoint,
        p256dh: browser.p256dh,
        auth: browser.auth,
        createdAt: NOW,
        lastSeenAt: NOW,
        failureCount: 0,
      }),
    );
  }
  return {
    t,
    users,
    browsers,
    addDevice,
    a: t.withIdentity(identity('auth-a')),
    b: t.withIdentity(identity('auth-b')),
    sends: () => t.run((ctx) => ctx.db.query('pushTestSends').collect()),
    jobs: (name: string) =>
      t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (job) => job.name.includes(name) && job.state.kind === 'pending',
        ),
      ),
    runScheduled: () => t.finishAllScheduledFunctions(vi.runAllTimers),
  };
}

const fetchedEndpoints = () => fetchMock.mock.calls.map((call) => call[0] as string).sort();

describe('push.sendTest', () => {
  test('sends to the caller’s devices only, and decrypts to the test notification there', async () => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    await s.addDevice(s.users.a, 'a-2');
    await s.addDevice(s.users.b, 'b-1');

    expect(await s.a.mutation(api.push.sendTest, {})).toEqual({ status: 'sent', devices: 2 });
    await s.runScheduled();

    expect(fetchedEndpoints()).toEqual([
      'https://fcm.googleapis.com/fcm/send/a-1',
      'https://fcm.googleapis.com/fcm/send/a-2',
    ]);
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/a-1'));
    const plaintext = await decryptPushBody(
      call?.[1]?.body as Uint8Array,
      s.browsers.get('https://fcm.googleapis.com/fcm/send/a-1')!,
    );
    expect(JSON.parse(plaintext)).toMatchObject({
      notification: {
        title: 'Omni League',
        navigate: 'https://staging.example.test/app/notifications',
      },
    });
  });

  test('the same call by B reaches only B’s device', async () => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    await s.addDevice(s.users.b, 'b-1');
    await s.b.mutation(api.push.sendTest, {});
    await s.runScheduled();
    expect(fetchedEndpoints()).toEqual(['https://fcm.googleapis.com/fcm/send/b-1']);
  });

  test('a fourth call within 10 minutes is refused, schedules nothing, and says how long to wait', async () => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    for (let i = 0; i < TEST_SEND_LIMIT; i++) {
      vi.setSystemTime(NOW + i * MINUTE_MS);
      expect(await s.a.mutation(api.push.sendTest, {})).toMatchObject({ status: 'sent' });
    }
    const before = (await s.jobs('deliver')).length;

    vi.setSystemTime(NOW + 3 * MINUTE_MS);
    const refused = await s.a.mutation(api.push.sendTest, {});
    expect(refused).toMatchObject({ status: 'rateLimited' });
    expect(refused).toHaveProperty(
      'retryAfterSeconds',
      expect.closeTo((TEST_SEND_WINDOW_MS - 3 * MINUTE_MS) / 1000, -1),
    );

    expect(await s.sends()).toHaveLength(TEST_SEND_LIMIT);
    expect(await s.jobs('deliver')).toHaveLength(before);
  });

  test('the limit is per user', async () => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    await s.addDevice(s.users.b, 'b-1');
    for (let i = 0; i < TEST_SEND_LIMIT; i++) await s.a.mutation(api.push.sendTest, {});
    expect(await s.a.mutation(api.push.sendTest, {})).toMatchObject({ status: 'rateLimited' });
    expect(await s.b.mutation(api.push.sendTest, {})).toMatchObject({ status: 'sent' });
  });

  test('a call 10 minutes after the first is allowed again, and clears the old rows', async () => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    for (let i = 0; i < TEST_SEND_LIMIT; i++) await s.a.mutation(api.push.sendTest, {});

    const later = NOW + TEST_SEND_WINDOW_MS + 10;
    vi.setSystemTime(later);
    expect(await s.a.mutation(api.push.sendTest, {})).toMatchObject({ status: 'sent' });

    const left = await s.sends();
    expect(left).toHaveLength(1);
    expect(left[0]?.sentAt).toBeGreaterThanOrEqual(later);
  });

  test.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'SITE_URL'])(
    'with %s unset: reports it as unconfigured, schedules nothing, and uses none of the limit',
    async (name) => {
      const s = await setup();
      await s.addDevice(s.users.a, 'a-1');
      vi.stubEnv(name, '');

      expect(await s.a.mutation(api.push.sendTest, {})).toEqual({ status: 'unconfigured' });

      expect(await s.jobs('deliver')).toEqual([]);
      expect(await s.sends()).toEqual([]);
    },
  );

  test('a caller with no device gets "no device", schedules nothing, and uses none of the limit', async () => {
    const s = await setup();
    await s.addDevice(s.users.b, 'b-1');

    expect(await s.a.mutation(api.push.sendTest, {})).toEqual({ status: 'noDevice' });

    expect(await s.jobs('deliver')).toEqual([]);
    expect(await s.jobs('expireTestSend')).toEqual([]);
    expect(await s.sends()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['unauthenticated', (s: Awaited<ReturnType<typeof setup>>) => s.t],
    [
      'an identity with no users row',
      (s: Awaited<ReturnType<typeof setup>>) => s.t.withIdentity(identity('ghost')),
    ],
  ])('%s: fails with Sign in required and schedules nothing', async (_case, caller) => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    await expect(caller(s).mutation(api.push.sendTest, {})).rejects.toThrow('Sign in required');
    expect(await s.jobs('deliver')).toEqual([]);
    expect(await s.sends()).toEqual([]);
  });

  test('schedules a delete of the counted row 10 minutes after the send, and it removes only that row', async () => {
    const s = await setup();
    await s.addDevice(s.users.a, 'a-1');
    await s.a.mutation(api.push.sendTest, {});
    vi.setSystemTime(NOW + 4 * MINUTE_MS);
    await s.a.mutation(api.push.sendTest, {});

    const [first, second] = (await s.sends()).sort((x, y) => x.sentAt - y.sentAt);
    const jobs = await s.jobs('expireTestSend');
    expect(jobs.map((job) => job.scheduledTime).sort()).toEqual([
      first.sentAt + TEST_SEND_WINDOW_MS,
      second.sentAt + TEST_SEND_WINDOW_MS,
    ]);

    await s.t.mutation(internal.pushSend.expireTestSend, { id: first._id });
    expect((await s.sends()).map((row) => row._id)).toEqual([second._id]);
    await s.t.mutation(internal.pushSend.expireTestSend, { id: first._id });
  });
});
