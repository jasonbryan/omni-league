/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { TEST_MESSAGE, pushPayload } from './lib/pushMessage';
import {
  SERVER_ERROR_BACKOFF_SECONDS,
  FAILURES_BEFORE_DELETE,
  MAX_RETRY_AFTER_SECONDS,
} from './lib/pushResponse';
import {
  base64Url,
  decryptPushBody,
  makeBrowserSubscription,
  makeVapidPair,
  readVapidAuthorization,
  type VapidPair,
} from './lib/pushTestKit';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.parse('2030-05-20T12:00:00Z');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const SITE_URL = 'https://staging.example.test';
const SUBJECT = 'mailto:support@example.test';
const FCM = 'https://fcm.googleapis.com/fcm/send/device-1';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

let vapid: VapidPair;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let logged: string[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vapid ??= await makeVapidPair();
  vi.stubEnv('VAPID_PUBLIC_KEY', vapid.publicKey);
  vi.stubEnv('VAPID_PRIVATE_KEY', vapid.privateKey);
  vi.stubEnv('VAPID_SUBJECT', SUBJECT);
  vi.stubEnv('SITE_URL', SITE_URL);
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 201 })));
  vi.stubGlobal('fetch', fetchMock);
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(
        args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
      );
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => ({
    a: await ctx.db.insert('users', { authUserId: 'auth-a', name: 'A', adultConfirmedAt: 0 }),
    b: await ctx.db.insert('users', { authUserId: 'auth-b', name: 'B', adultConfirmedAt: 0 }),
  }));
  async function addDevice(
    userId: Id<'users'>,
    fields: { endpoint?: string; expirationTime?: number; failureCount?: number } = {},
  ) {
    const browser = await makeBrowserSubscription();
    const endpoint = fields.endpoint ?? FCM;
    const id = await t.run((ctx) =>
      ctx.db.insert('pushSubscriptions', {
        userId,
        endpoint,
        p256dh: browser.p256dh,
        auth: browser.auth,
        expirationTime: fields.expirationTime,
        createdAt: NOW,
        lastSeenAt: NOW,
        failureCount: fields.failureCount ?? 0,
      }),
    );
    return { id, browser, endpoint };
  }
  return {
    t,
    users,
    a: t.withIdentity(identity('auth-a')),
    b: t.withIdentity(identity('auth-b')),
    addDevice,
    row: (id: Id<'pushSubscriptions'>) => t.run((ctx) => ctx.db.get('pushSubscriptions', id)),
    tokens: () => t.run((ctx) => ctx.db.query('pushVapidTokens').collect()),
    pendingDeliveries: () =>
      t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (job) => job.name.includes('deliver') && job.state.kind === 'pending',
        ),
      ),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

function deliver(
  s: Setup,
  device: { id: Id<'pushSubscriptions'> },
  userId: Id<'users'>,
  retries: { serverErrorRetries?: number; rateLimitRetries?: number } = {},
) {
  return s.t.action(internal.pushSend.deliver, {
    subscriptionId: device.id,
    userId,
    message: TEST_MESSAGE,
    ...retries,
  });
}

function respond(status: number, init: ResponseInit & { body?: string } = {}) {
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(new Response(init.body ?? null, { ...init, status })),
  );
}

const sentHeaders = (call = 0) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);

describe('deliver: the request', () => {
  test('the body decrypts to the exact payload, with the headers the push service needs', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);

    await deliver(s, device, s.users.a);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(FCM);
    expect(init?.method?.toUpperCase()).toBe('POST');
    const headers = sentHeaders();
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(headers.get('ttl')).toBe('86400');
    expect(headers.get('urgency')).toBe('normal');
    expect(headers.get('topic')).toBe('test-notification');
    const body = init?.body as Uint8Array;
    expect(body.byteLength).toBe(4096);
    const plaintext = await decryptPushBody(body, device.browser);
    expect(plaintext).toBe(pushPayload(TEST_MESSAGE, SITE_URL));
    expect(JSON.parse(plaintext)).toMatchObject({ notification: { title: 'Omni League' } });
  });

  test('Authorization is a VAPID token for the push service origin, signed by the VAPID key, valid under a day', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);

    await deliver(s, device, s.users.a);

    const claims = await readVapidAuthorization(sentHeaders().get('authorization') ?? '');
    expect(claims.signatureValid).toBe(true);
    expect(claims.publicKeyParameter).toBe(vapid.publicKey);
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe(SUBJECT);
    expect(claims.exp * 1000).toBeGreaterThan(NOW);
    expect(claims.exp * 1000).toBeLessThanOrEqual(NOW + 24 * HOUR_MS);
  });

  test('does not follow a redirect to another host', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    await deliver(s, device, s.users.a);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  test('a delivery sets lastSuccessAt and resets failureCount', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a, { failureCount: 3 });
    await deliver(s, device, s.users.a);
    const row = await s.row(device.id);
    expect(row?.failureCount).toBe(0);
    expect(row?.lastSuccessAt).toBeGreaterThanOrEqual(NOW);
    expect(row?.lastSuccessAt).toBeLessThan(NOW + 1000);
  });

  test('a 202 counts as delivered too', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(202);
    await deliver(s, device, s.users.a);
    expect((await s.row(device.id))?.lastSuccessAt).toBeGreaterThanOrEqual(NOW);
  });
});

describe('deliver: the VAPID token', () => {
  async function tokenAfter(s: Setup, device: { id: Id<'pushSubscriptions'> }, at: number) {
    vi.setSystemTime(at);
    fetchMock.mockClear();
    await deliver(s, device, s.users.a);
    return sentHeaders().get('authorization');
  }

  test('two sends to one origin 10 minutes apart carry the same token', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    const first = await tokenAfter(s, device, NOW);
    const second = await tokenAfter(s, device, NOW + 10 * MINUTE_MS);
    expect(second).toBe(first);
    expect(await s.tokens()).toHaveLength(1);
  });

  test('a send 12 hours later carries a new token', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    const first = await tokenAfter(s, device, NOW);
    const later = await tokenAfter(s, device, NOW + 12 * HOUR_MS);
    expect(later).not.toBe(first);
    expect(await s.tokens()).toHaveLength(1);
  });

  test('the token is reused until 1 hour before it expires, and not after', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    const first = await tokenAfter(s, device, NOW);
    expect(await tokenAfter(s, device, NOW + 11 * HOUR_MS - MINUTE_MS)).toBe(first);
    expect(await tokenAfter(s, device, NOW + 11 * HOUR_MS + MINUTE_MS)).not.toBe(first);
  });

  test('each push service origin gets its own token', async () => {
    const s = await setup();
    const fcm = await s.addDevice(s.users.a);
    const apple = await s.addDevice(s.users.a, { endpoint: 'https://web.push.apple.com/Qabc' });
    await deliver(s, fcm, s.users.a);
    await deliver(s, apple, s.users.a);
    const [fcmToken, appleToken] = fetchMock.mock.calls.map(
      (call) => new Headers(call[1]?.headers).get('authorization') ?? '',
    );
    expect((await readVapidAuthorization(fcmToken ?? '')).aud).toBe('https://fcm.googleapis.com');
    expect((await readVapidAuthorization(appleToken ?? '')).aud).toBe('https://web.push.apple.com');
    expect(await s.tokens()).toHaveLength(2);
  });

  test('a changed VAPID public key does not reuse the old token', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    await deliver(s, device, s.users.a);
    const rotated = await makeVapidPair();
    vi.stubEnv('VAPID_PUBLIC_KEY', rotated.publicKey);
    vi.stubEnv('VAPID_PRIVATE_KEY', rotated.privateKey);
    fetchMock.mockClear();

    await deliver(s, device, s.users.a);

    const claims = await readVapidAuthorization(sentHeaders().get('authorization') ?? '');
    expect(claims.publicKeyParameter).toBe(rotated.publicKey);
    expect(claims.signatureValid).toBe(true);
  });

  test('a token past its expiry is replaced, and expired tokens of other origins are dropped', async () => {
    const s = await setup();
    const apple = await s.addDevice(s.users.a, { endpoint: 'https://web.push.apple.com/Qabc' });
    const fcm = await s.addDevice(s.users.a);
    await deliver(s, apple, s.users.a);
    vi.setSystemTime(NOW + 13 * HOUR_MS);
    await deliver(s, fcm, s.users.a);
    expect((await s.tokens()).map((token) => token.origin)).toEqual(['https://fcm.googleapis.com']);
  });
});

describe('deliver: the push service answers', () => {
  test.each([404, 410])('%i deletes the row', async (status) => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(status);
    await deliver(s, device, s.users.a);
    expect(await s.row(device.id)).toBeNull();
    expect(await s.pendingDeliveries()).toEqual([]);
  });

  test('413 logs an error, keeps the row, and does not retry', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(413);
    await deliver(s, device, s.users.a);
    expect(await s.row(device.id)).not.toBeNull();
    expect(await s.pendingDeliveries()).toEqual([]);
    expect(logged.some((line) => line.includes('413'))).toBe(true);
  });

  test('429 with Retry-After 120 schedules exactly one retry 120 seconds later, for the same row and user', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(429, { headers: { 'Retry-After': '120' } });

    await deliver(s, device, s.users.a);

    const jobs = await s.pendingDeliveries();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.scheduledTime).toBe(NOW + 120_000);
    expect(jobs[0]?.args[0]).toMatchObject({
      subscriptionId: device.id,
      userId: s.users.a,
      rateLimitRetries: 1,
    });
  });

  test('a second 429 on the retry schedules nothing more', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(429, { headers: { 'Retry-After': '1' } });
    respond(429, { headers: { 'Retry-After': '1' } });
    await deliver(s, device, s.users.a);
    const [job] = await s.pendingDeliveries();
    await s.t.action(internal.pushSend.deliver, job?.args[0] as never);
    expect(await s.pendingDeliveries()).toHaveLength(1);
  });

  test('a Retry-After of a day is capped at an hour', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(429, { headers: { 'Retry-After': '86400' } });
    await deliver(s, device, s.users.a);
    const [job] = await s.pendingDeliveries();
    expect(job?.scheduledTime).toBe(NOW + MAX_RETRY_AFTER_SECONDS * 1000);
  });

  test.each([
    ['a 500', () => respond(500)],
    [
      'a lost response',
      () => fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('network'))),
    ],
  ])('%s is retried 3 times with growing waits, and no more', async (_case, fail) => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    const scheduledDelays: number[] = [];
    let args: Parameters<typeof deliver>[3] = {};
    for (let attempt = 0; attempt <= 3; attempt++) {
      fail();
      await s.t.action(internal.pushSend.deliver, {
        subscriptionId: device.id,
        userId: s.users.a,
        message: TEST_MESSAGE,
        ...args,
      });
      const jobs = await s.pendingDeliveries();
      if (jobs.length === attempt) break;
      const job = jobs.at(-1);
      scheduledDelays.push((job?.scheduledTime ?? 0) - NOW);
      args = job?.args[0] as typeof args;
    }
    expect(scheduledDelays).toEqual(SERVER_ERROR_BACKOFF_SECONDS.map((seconds) => seconds * 1000));
    expect(await s.pendingDeliveries()).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test('a row that keeps getting 500 is not counted as failing', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(500);
    await deliver(s, device, s.users.a, { serverErrorRetries: 3 });
    expect((await s.row(device.id))?.failureCount).toBe(0);
  });

  test('another 4xx counts a failure and logs only the reason', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(403, { body: JSON.stringify({ reason: 'BadJwtToken' }) });
    await deliver(s, device, s.users.a);
    expect((await s.row(device.id))?.failureCount).toBe(1);
    expect(logged.some((line) => line.includes('BadJwtToken') && line.includes('403'))).toBe(true);
    expect(await s.pendingDeliveries()).toEqual([]);
  });

  test(`${FAILURES_BEFORE_DELETE} failures in a row delete the row, and a delivery in between starts the count again`, async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    for (let i = 1; i < FAILURES_BEFORE_DELETE; i++) {
      respond(400);
      await deliver(s, device, s.users.a);
      expect((await s.row(device.id))?.failureCount).toBe(i);
    }
    await deliver(s, device, s.users.a);
    expect((await s.row(device.id))?.failureCount).toBe(0);
    for (let i = 0; i < FAILURES_BEFORE_DELETE; i++) {
      expect(await s.row(device.id)).not.toBeNull();
      respond(400);
      await deliver(s, device, s.users.a);
    }
    expect(await s.row(device.id)).toBeNull();
  });

  test('the logs name the push service host and status, and no endpoint, key, token, or secret', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/very-secret-endpoint-path',
    });
    respond(400, { body: JSON.stringify({ reason: 'BadJwtToken', echo: device.endpoint }) });
    await deliver(s, device, s.users.a);
    respond(413);
    await deliver(s, device, s.users.a);
    respond(500);
    await deliver(s, device, s.users.a);

    expect(logged.length).toBeGreaterThan(0);
    const everything = logged.join('\n');
    expect(everything).toContain('fcm.googleapis.com');
    const secrets = [
      'very-secret-endpoint-path',
      device.browser.p256dh,
      device.browser.auth,
      vapid.privateKey,
      'vapid t=',
      SUBJECT,
    ];
    for (const secret of secrets) expect(everything).not.toContain(secret);
  });
});

describe('deliver: what it will not send', () => {
  test('a row whose endpoint host is not on the allow-list gets no request', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a, { endpoint: 'https://push.example.com/x' });
    await deliver(s, device, s.users.a);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each(['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x'])(
    'a row for %s gets no request',
    async (endpoint) => {
      const s = await setup();
      const device = await s.addDevice(s.users.a, { endpoint });
      await deliver(s, device, s.users.a);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test('a row deleted since scheduling is skipped without error', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    await s.t.run((ctx) => ctx.db.delete('pushSubscriptions', device.id));
    await expect(deliver(s, device, s.users.a)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a row past its expirationTime is skipped and deleted', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a, { expirationTime: NOW - 1 });
    await deliver(s, device, s.users.a);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.row(device.id)).toBeNull();
  });

  test('a row with an expirationTime still ahead is sent to', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a, { expirationTime: NOW + HOUR_MS });
    await deliver(s, device, s.users.a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a row whose userId differs from the one scheduled is skipped and left alone', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.b);
    await deliver(s, device, s.users.a);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.row(device.id)).toMatchObject({ userId: s.users.b, failureCount: 0 });
    expect((await s.row(device.id))?.lastSuccessAt).toBeUndefined();
  });

  test('B subscribing A’s endpoint before delivery: B gets nothing', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    await s.b.mutation(api.push.subscribe, {
      endpoint: device.endpoint,
      expirationTime: null,
      keys: { p256dh: device.browser.p256dh, auth: device.browser.auth },
    });

    await deliver(s, device, s.users.a);

    expect(fetchMock).not.toHaveBeenCalled();
    const rows = await s.t.run((ctx) => ctx.db.query('pushSubscriptions').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: s.users.b, failureCount: 0 });
    expect(rows[0]?.lastSuccessAt).toBeUndefined();
  });

  test('B subscribing A’s endpoint between a 429 and its retry: B gets nothing', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    respond(429, { headers: { 'Retry-After': '600' } });
    await deliver(s, device, s.users.a);
    const [retry] = await s.pendingDeliveries();
    await s.b.mutation(api.push.subscribe, {
      endpoint: device.endpoint,
      expirationTime: null,
      keys: { p256dh: device.browser.p256dh, auth: device.browser.auth },
    });
    fetchMock.mockClear();

    await s.t.action(internal.pushSend.deliver, retry?.args[0] as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'SITE_URL'])(
    'with %s unset, nothing is sent, the row is kept, and the log names the variable only',
    async (name) => {
      const s = await setup();
      const device = await s.addDevice(s.users.a, { failureCount: 2 });
      vi.stubEnv(name, '');

      await deliver(s, device, s.users.a);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await s.row(device.id)).toMatchObject({ failureCount: 2 });
      expect(await s.pendingDeliveries()).toEqual([]);
      expect(logged.join('\n')).toContain(name);
    },
  );

  test('a private key that is not a key leaves every row alone', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    vi.stubEnv('VAPID_PRIVATE_KEY', 'not-a-key');
    await deliver(s, device, s.users.a);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.row(device.id)).toMatchObject({ failureCount: 0 });
    expect(logged.join('\n')).not.toContain('not-a-key');
  });

  test('a subscription whose keys cannot encrypt counts as a failure and sends nothing', async () => {
    const s = await setup();
    const device = await s.addDevice(s.users.a);
    const broken = base64Url(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 1)));
    await s.t.run((ctx) => ctx.db.patch('pushSubscriptions', device.id, { p256dh: broken }));
    await deliver(s, device, s.users.a);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await s.row(device.id))?.failureCount).toBe(1);
  });
});
