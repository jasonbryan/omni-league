/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import { isForbidden } from './lib/forbidden';
import { authUserIdByEmail } from './lib/authUsers';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import schema from './schema';
import seedSource from './seed.ts?raw';
import { modules } from './test.setup';

const SITE_URL = 'http://localhost:4000';
const DOMAIN = 'demo.omni-league.test';
const EMAILS = {
  admin: `admin@${DOMAIN}`,
  organizer: `organizer@${DOMAIN}`,
  player: `player@${DOMAIN}`,
} as const;
const INVITED = `invited@${DOMAIN}`;
const PASSWORD = 'throwaway demo passphrase 2026';
const OTHER_PASSWORD = 'a different throwaway phrase 2026';
const GULF_COAST = 'gulf-coast-sport-social';
const PORT_ARANSAS = 'port-aransas-beach-volleyball-club';
const SAGUARO = 'saguaro-valley-softball';
const ROCKPORT = 'rockport-sand-volleyball';
const SLOW = 120_000;

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}
type T = ReturnType<typeof setup>;

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function pwnedRangeResponse(breachedSuffix?: string): Response {
  const lines = ['0018A45C4D1DEF81644B54AB7F969B88D65:0', '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'];
  if (breachedSuffix) lines.push(`${breachedSuffix}:3730471`);
  return new Response(lines.join('\r\n'), { status: 200 });
}

let pwned: ReturnType<typeof vi.fn<(input: RequestInfo | URL) => Promise<Response>>>;

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
  vi.stubEnv('SITE_URL', SITE_URL);
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-0123456789abcdef0123456789');
  vi.stubEnv('IS_TEST', undefined);
  vi.stubEnv('PREVIEW_ORIGIN_PATTERN', PREVIEW_ORIGIN_PATTERN);
  vi.stubEnv('DEMO_ACCOUNT_PASSWORD', PASSWORD);
  pwned = vi.fn(() => Promise.resolve(pwnedRangeResponse()));
  vi.stubGlobal('fetch', pwned);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = (t: T) => t.action(internal.seed.demo, {});

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

async function as(t: T, email: string) {
  const authUserId = await t.run((ctx) => authUserIdByEmail(ctx, email));
  if (!authUserId) throw new Error(`no account for ${email}`);
  return t.withIdentity(identity(authUserId));
}

async function post(t: T, path: string, body: unknown) {
  const response = await t.fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE_URL },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : {} };
}

const signIn = (t: T, email: string, password = PASSWORD) =>
  post(t, 'sign-in/email', { email, password });

async function signUp(t: T, email: string, password: string) {
  const answer = await post(t, 'sign-up/email', {
    name: 'Someone Else',
    email,
    password,
    adultConfirmed: true,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
}

type AuthModel = 'user' | 'account' | 'session';

async function authRows(t: T, model: AuthModel): Promise<Record<string, unknown>[]> {
  return t.run(async (ctx) => {
    const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      paginationOpts: { numItems: 200, cursor: null },
    })) as { page: Record<string, unknown>[] };
    return page;
  });
}

async function appRows(t: T) {
  return t.run(async (ctx) => ({
    users: await ctx.db.query('users').collect(),
    memberships: await ctx.db.query('memberships').collect(),
    invites: await ctx.db.query('invites').collect(),
    organizations: await ctx.db.query('organizations').collect(),
    leagues: await ctx.db.query('leagues').collect(),
  }));
}

async function membershipsOf(t: T, email: string) {
  return t.run(async (ctx) => {
    const authUserId = await authUserIdByEmail(ctx, email);
    if (!authUserId) return [];
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user) return [];
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', user._id))
      .collect();
    const result = [];
    for (const row of rows) {
      const organization = await ctx.db.get('organizations', row.organizationId);
      const leagues = [];
      for (const id of row.leagueIds) leagues.push((await ctx.db.get('leagues', id))?.slug);
      result.push({ organization: organization?.slug, role: row.role, leagues });
    }
    return result.sort((a, b) => String(a.organization).localeCompare(String(b.organization)));
  });
}

const ALL = (code: string) => ({ admin: code, organizer: code, player: code });
const DATA = { organizations: 6, locations: 11, customLevels: 1, leagues: 17, seasons: 4 };
const NO_BACKFILL = { organizations: 0, locations: 0, leagues: 0, seasons: 0, leagueDivisions: 0 };

describe('seed:demo accounts: a new deployment', () => {
  test(
    'creates the three accounts, which sign in with the password',
    async () => {
      const t = setup();
      const result = await run(t);
      expect(result).toEqual({
        ...DATA,
        backfilled: NO_BACKFILL,
        memberships: 5,
        invites: 1,
        accounts: ALL('created'),
      });
      for (const email of Object.values(EMAILS)) {
        const answer = await signIn(t, email);
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(answer.json).toHaveProperty('token');
      }
      expect((await signIn(t, EMAILS.admin, OTHER_PASSWORD)).status).toBe(401);
      const { users } = await appRows(t);
      expect(users).toHaveLength(3);
      for (const user of users) expect(user.adultConfirmedAt).toBeGreaterThan(0);
    },
    SLOW,
  );

  test(
    'gives each account its memberships and the one pending invite',
    async () => {
      const t = setup();
      await run(t);
      expect(await membershipsOf(t, EMAILS.admin)).toEqual([
        { organization: GULF_COAST, role: 'orgAdmin', leagues: [] },
        { organization: PORT_ARANSAS, role: 'orgAdmin', leagues: [] },
        { organization: ROCKPORT, role: 'orgAdmin', leagues: [] },
        { organization: SAGUARO, role: 'orgAdmin', leagues: [] },
      ]);
      expect(await membershipsOf(t, EMAILS.organizer)).toEqual([
        { organization: GULF_COAST, role: 'leagueOrganizer', leagues: ['sunday-reverse-coed-4s'] },
      ]);
      expect(await membershipsOf(t, EMAILS.player)).toEqual([]);
      const { memberships, invites, leagues, organizations } = await appRows(t);
      expect(memberships).toHaveLength(5);
      expect(invites).toHaveLength(1);
      const gulfCoast = organizations.find((o) => o.slug === GULF_COAST);
      const league = leagues.find((l) => l.slug === 'coed-7v7-rec');
      expect(invites[0]).toMatchObject({
        organizationId: gulfCoast?._id,
        email: INVITED,
        role: 'leagueOrganizer',
        leagueIds: [league?._id],
        status: 'pending',
      });
      expect(invites[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(invites[0]?.expiresAt).toBeGreaterThan(Date.now());
    },
    SLOW,
  );

  test(
    'the admin account sees the demo custom level D in its softball levels and in its league’s label',
    async () => {
      const t = setup();
      await run(t);
      const { organizations } = await appRows(t);
      const saguaro = organizations.find((o) => o.slug === SAGUARO);
      if (!saguaro) throw new Error('demo organization missing');
      const admin = await as(t, EMAILS.admin);
      expect(
        (
          await admin.query(api.customLevels.listForSport, {
            organizationId: saguaro._id,
            sport: 'softball',
          })
        ).map(({ name, standardLevel }) => [name, standardLevel]),
      ).toEqual([['D', 'rec']]);
      const labels = (
        await admin.query(api.leagues.listForAdmin, { organizationId: saguaro._id })
      ).map((league) => league.divisionLabel);
      expect(labels).toContain("Men's · 10v10 · D (Rec)");
    },
    SLOW,
  );

  test(
    'each account sees what its role should: org admin, assigned organizer, plain player',
    async () => {
      const t = setup();
      await run(t);
      const { organizations, leagues } = await appRows(t);
      const gulfCoast = organizations.find((o) => o.slug === GULF_COAST);
      const portAransas = organizations.find((o) => o.slug === PORT_ARANSAS);
      if (!gulfCoast || !portAransas) throw new Error('demo organizations missing');
      const gulfCoastLeagues = leagues.filter((l) => l.organizationId === gulfCoast._id);
      expect(gulfCoastLeagues).toHaveLength(5);

      const admin = await as(t, EMAILS.admin);
      expect((await admin.query(api.organizations.listMine, {})).map((o) => o.slug)).toEqual([
        GULF_COAST,
        PORT_ARANSAS,
        ROCKPORT,
        SAGUARO,
      ]);
      expect(
        (await admin.query(api.leagues.listForAdmin, { organizationId: gulfCoast._id })).map(
          (l) => l.slug,
        ),
      ).toHaveLength(5);
      const staff = await admin.query(api.memberships.listForOrganization, {
        organizationId: gulfCoast._id,
      });
      expect(staff.map((s) => [s.email, s.role]).sort()).toEqual([
        [EMAILS.admin, 'orgAdmin'],
        [EMAILS.organizer, 'leagueOrganizer'],
      ]);
      const pending = await admin.query(api.invites.listPending, {
        organizationId: gulfCoast._id,
      });
      expect(pending).toMatchObject([
        { email: INVITED, role: 'leagueOrganizer', leagueNames: ['Coed 7v7 Rec'] },
      ]);

      const organizer = await as(t, EMAILS.organizer);
      expect(await organizer.query(api.organizations.listMine, {})).toEqual([
        {
          name: 'Gulf Coast Sport & Social',
          slug: GULF_COAST,
          role: 'leagueOrganizer',
          leagues: [{ name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' }],
        },
      ]);
      expect(
        await organizer.query(api.leagues.getOrganizerContext, {
          orgSlug: GULF_COAST,
          leagueSlug: 'sunday-reverse-coed-4s',
        }),
      ).toMatchObject({ slug: 'sunday-reverse-coed-4s', role: 'leagueOrganizer' });
      const refused = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (failure) {
          return isForbidden(failure) || String(failure).includes('Not allowed');
        }
        return false;
      };
      expect(
        await refused(() =>
          organizer.query(api.leagues.getOrganizerContext, {
            orgSlug: GULF_COAST,
            leagueSlug: 'coed-7v7-rec',
          }),
        ),
      ).toBe(true);
      expect(
        await refused(() =>
          organizer.query(api.leagues.listForAdmin, { organizationId: gulfCoast._id }),
        ),
      ).toBe(true);
      expect(
        await refused(() =>
          organizer.query(api.memberships.listForOrganization, { organizationId: gulfCoast._id }),
        ),
      ).toBe(true);
      expect(
        await refused(() =>
          organizer.query(api.invites.listPending, { organizationId: gulfCoast._id }),
        ),
      ).toBe(true);

      const player = await as(t, EMAILS.player);
      expect(await player.query(api.organizations.listMine, {})).toEqual([]);
      for (const query of [
        () => player.query(api.leagues.listForAdmin, { organizationId: gulfCoast._id }),
        () => player.query(api.memberships.listForOrganization, { organizationId: gulfCoast._id }),
        () => player.query(api.invites.listPending, { organizationId: gulfCoast._id }),
        () =>
          player.query(api.leagues.getOrganizerContext, {
            orgSlug: GULF_COAST,
            leagueSlug: 'sunday-reverse-coed-4s',
          }),
      ]) {
        expect(await refused(query)).toBe(true);
      }
    },
    SLOW,
  );
});

describe('seed:demo accounts: a second run', () => {
  test(
    'returns exists for all, duplicates nothing, makes no breach call and no session',
    async () => {
      const t = setup();
      await run(t);
      const before = {
        app: await appRows(t),
        users: await authRows(t, 'user'),
        accounts: await authRows(t, 'account'),
        sessions: await authRows(t, 'session'),
      };
      const calls = pwned.mock.calls.length;
      const second = await run(t);
      expect(second).toEqual({
        organizations: 0,
        locations: 0,
        customLevels: 0,
        leagues: 0,
        seasons: 0,
        backfilled: NO_BACKFILL,
        memberships: 0,
        invites: 0,
        accounts: ALL('exists'),
      });
      expect({
        app: await appRows(t),
        users: await authRows(t, 'user'),
        accounts: await authRows(t, 'account'),
        sessions: await authRows(t, 'session'),
      }).toEqual(before);
      expect(pwned.mock.calls.length).toBe(calls);
      expect(await t.run((ctx) => ctx.db.query('signInFailures').collect())).toEqual([]);
    },
    SLOW,
  );

  test(
    'puts back a deleted membership and changes no other row',
    async () => {
      const t = setup();
      await run(t);
      const before = await appRows(t);
      const gone = before.memberships.find((m) => m.role === 'orgAdmin');
      if (!gone) throw new Error('no admin membership');
      await t.run((ctx) => ctx.db.delete('memberships', gone._id));
      const second = await run(t);
      expect(second.memberships).toBe(1);
      expect(second.accounts).toEqual(ALL('exists'));
      const after = await appRows(t);
      expect(after.memberships).toHaveLength(5);
      expect(after.memberships.map((m) => [m.userId, m.organizationId, m.role]).sort()).toEqual(
        before.memberships.map((m) => [m.userId, m.organizationId, m.role]).sort(),
      );
      expect({ ...after, memberships: [] }).toEqual({ ...before, memberships: [] });
    },
    SLOW,
  );
});

describe('seed:demo accounts: an address someone else holds', () => {
  test(
    'a different password gives conflict, no membership, and leaves the hash and sessions',
    async () => {
      const t = setup();
      await signUp(t, EMAILS.organizer, OTHER_PASSWORD);
      const hashes = async () =>
        (await authRows(t, 'account')).map((a) => [a['userId'], a['password']]);
      const hashBefore = await hashes();
      const sessionsBefore = await authRows(t, 'session');
      expect(sessionsBefore).toHaveLength(1);

      const result = await run(t);
      expect(result.accounts).toEqual({
        admin: 'created',
        organizer: 'conflict',
        player: 'created',
      });
      expect(await membershipsOf(t, EMAILS.organizer)).toEqual([]);
      expect(await membershipsOf(t, EMAILS.admin)).toHaveLength(4);
      expect(await hashes()).toEqual(expect.arrayContaining(hashBefore));
      expect(await authRows(t, 'session')).toEqual(expect.arrayContaining(sessionsBefore));
      expect((await signIn(t, EMAILS.organizer, OTHER_PASSWORD)).status).toBe(200);
      expect((await signIn(t, EMAILS.organizer, PASSWORD)).status).toBe(401);
      expect(result.memberships).toBe(4);
    },
    SLOW,
  );

  test(
    'a user with no credential row gives conflict, writes nothing to it, and does not throw',
    async () => {
      const t = setup();
      const now = Date.now();
      await t.run((ctx) =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: 'user',
            data: {
              name: 'Half Made',
              email: EMAILS.player,
              emailVerified: false,
              createdAt: now,
              updatedAt: now,
            },
          },
        }),
      );
      const result = await run(t);
      expect(result.accounts).toEqual({
        admin: 'created',
        organizer: 'created',
        player: 'conflict',
      });
      const players = (await authRows(t, 'user')).filter((u) => u['email'] === EMAILS.player);
      expect(players).toHaveLength(1);
      expect((await authRows(t, 'account')).map((a) => a['userId'])).not.toContain(
        players[0]?.['_id'],
      );
      expect(await authRows(t, 'session')).toHaveLength(2);
      expect(await membershipsOf(t, EMAILS.player)).toEqual([]);
    },
    SLOW,
  );
});

describe('seed:demo accounts: the password', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
  ])(
    'when it is %s, every code is skipped:unset, no account exists, and the data and invite are seeded',
    async (_name, value) => {
      vi.stubEnv('DEMO_ACCOUNT_PASSWORD', value);
      const t = setup();
      const result = await run(t);
      expect(result).toEqual({
        ...DATA,
        backfilled: NO_BACKFILL,
        memberships: 0,
        invites: 1,
        accounts: ALL('skipped:unset'),
      });
      expect(await authRows(t, 'user')).toEqual([]);
      expect(await authRows(t, 'account')).toEqual([]);
      expect((await appRows(t)).memberships).toEqual([]);
      expect(pwned).not.toHaveBeenCalled();
    },
    SLOW,
  );

  test(
    'unset after set: the accounts keep the last password and nothing changes',
    async () => {
      const t = setup();
      await run(t);
      const before = {
        app: await appRows(t),
        accounts: await authRows(t, 'account'),
        sessions: await authRows(t, 'session'),
      };
      vi.stubEnv('DEMO_ACCOUNT_PASSWORD', undefined);
      const result = await run(t);
      expect(result.accounts).toEqual(ALL('skipped:unset'));
      expect({
        app: await appRows(t),
        accounts: await authRows(t, 'account'),
        sessions: await authRows(t, 'session'),
      }).toEqual(before);
      expect((await signIn(t, EMAILS.admin)).status).toBe(200);
    },
    SLOW,
  );

  const breached = async () => {
    const hash = await sha1Hex(PASSWORD);
    pwned.mockImplementation(() => Promise.resolve(pwnedRangeResponse(hash.slice(5))));
  };

  test.each([
    [
      '14 characters',
      'rejected:too_short',
      () => vi.stubEnv('DEMO_ACCOUNT_PASSWORD', 'a'.repeat(14)),
    ],
    [
      '129 characters',
      'rejected:too_long',
      () => vi.stubEnv('DEMO_ACCOUNT_PASSWORD', 'a'.repeat(129)),
    ],
    ['a breached value', 'rejected:breached', breached],
    [
      'an unreachable breach check',
      'rejected:check_unavailable',
      () => pwned.mockImplementation(() => Promise.reject(new TypeError('fetch failed'))),
    ],
    [
      'a failing breach check',
      'rejected:check_unavailable',
      () => pwned.mockImplementation(() => Promise.resolve(new Response('', { status: 503 }))),
    ],
  ])(
    'with %s, every code is %s, no account is created, the run does not throw, and the data is seeded',
    async (_name, code, arrange) => {
      await arrange();
      const t = setup();
      const result = await run(t);
      expect(result.accounts).toEqual(ALL(code));
      expect(result).toMatchObject({ ...DATA, memberships: 0, invites: 1 });
      expect(await authRows(t, 'user')).toEqual([]);
      expect(await authRows(t, 'account')).toEqual([]);
      expect((await appRows(t)).memberships).toEqual([]);
    },
    SLOW,
  );

  test(
    'an unexpected error fails the run without the password in its message',
    async () => {
      // With no auth secret every sign-up is refused with AUTH_NOT_CONFIGURED: not a code the seed maps.
      vi.stubEnv('BETTER_AUTH_SECRET', '');
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const t = setup();
      const failure = await run(t).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(PASSWORD);
    },
    SLOW,
  );
});

describe('seed:demo accounts: the production guard', () => {
  const calls: [string, (t: T) => Promise<unknown>][] = [
    ['seed:demo', (t) => t.action(internal.seed.demo, {})],
    ['insertDemoData', (t) => t.mutation(internal.seed.insertDemoData, {})],
    ['insertDemoInvite', (t) => t.mutation(internal.seed.insertDemoInvite, { tokenHash: 'x' })],
    [
      'grantDemoMemberships',
      (t) =>
        t.mutation(internal.seed.grantDemoMemberships, { authUserId: 'someone', account: 'admin' }),
    ],
    ['findDemoCredential', (t) => t.query(internal.seed.findDemoCredential, { account: 'admin' })],
  ];

  test.each(calls)(
    '%s throws before writing anything when PREVIEW_ORIGIN_PATTERN is unset or another string',
    async (_name, call) => {
      for (const value of [undefined, '^https://example\\.com$']) {
        vi.stubEnv('PREVIEW_ORIGIN_PATTERN', value);
        const t = setup();
        await expect(call(t)).rejects.toThrow(/PREVIEW_ORIGIN_PATTERN/);
        const rows = await appRows(t);
        expect(Object.values(rows).flat()).toEqual([]);
        expect(await authRows(t, 'user')).toEqual([]);
      }
    },
  );
});

describe('seed:demo accounts: two runs at once', () => {
  test(
    'neither throws, and the final rows are one per address and one membership and invite each',
    async () => {
      const t = setup();
      const results = await Promise.all([run(t), run(t)]);
      for (const result of results) {
        for (const code of Object.values(result.accounts)) {
          expect(['created', 'exists', 'conflict']).toContain(code);
        }
      }
      const users = await authRows(t, 'user');
      const accounts = await authRows(t, 'account');
      for (const email of Object.values(EMAILS)) {
        const user = users.filter((u) => u['email'] === email);
        expect(user).toHaveLength(1);
        expect(accounts.filter((a) => a['userId'] === user[0]?.['_id'])).toHaveLength(1);
      }
      // A run that lost the race may have left an account without a role; the next run settles it.
      const third = await run(t);
      expect(third.accounts).toEqual(ALL('exists'));
      const rows = await appRows(t);
      expect(rows.users).toHaveLength(3);
      expect(rows.memberships).toHaveLength(5);
      expect(rows.invites).toHaveLength(1);
      expect(await membershipsOf(t, EMAILS.admin)).toHaveLength(4);
      expect(await membershipsOf(t, EMAILS.organizer)).toHaveLength(1);
    },
    SLOW,
  );
});

describe('seed:demo accounts: the password never leaks', () => {
  const SENTINEL = 'sentinel-passphrase-7Q9x-do-not-log';

  test(
    'no return value, thrown error, console output, or credential query result holds it',
    async () => {
      vi.stubEnv('DEMO_ACCOUNT_PASSWORD', SENTINEL);
      const logged: string[] = [];
      for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logged.push(
            args
              .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a)))
              .join(' '),
          );
        });
      }
      const outputs: string[] = [];
      const attempt = async (t: T) => {
        try {
          outputs.push(JSON.stringify(await run(t)));
        } catch (error) {
          outputs.push(
            error instanceof Error
              ? `${error.name} ${error.message} ${error.stack}`
              : String(error),
          );
        }
      };

      const seedTwice = async () => {
        const t = setup();
        await attempt(t);
        await attempt(t);
        return t;
      };
      const readStoredHash = async (t: T) =>
        outputs.push(
          JSON.stringify(await t.query(internal.seed.findDemoCredential, { account: 'admin' })),
        );
      const seedOverTakenAddress = async () => {
        const t = setup();
        await signUp(t, EMAILS.player, OTHER_PASSWORD);
        await attempt(t);
      };
      const seedWithBreachedPassword = async () => {
        const hash = await sha1Hex(SENTINEL);
        pwned.mockImplementation(() => Promise.resolve(pwnedRangeResponse(hash.slice(5))));
        await attempt(setup());
      };
      const seedWithUnreachableBreachCheck = async () => {
        pwned.mockImplementation(() => Promise.reject(new Error(`failed for ${SENTINEL}`)));
        await attempt(setup());
      };
      const seedWithShortPassword = async () => {
        vi.stubEnv('DEMO_ACCOUNT_PASSWORD', SENTINEL.slice(0, 10));
        await attempt(setup());
        vi.stubEnv('DEMO_ACCOUNT_PASSWORD', SENTINEL);
      };
      const seedWithoutPassword = async () => {
        vi.stubEnv('DEMO_ACCOUNT_PASSWORD', undefined);
        await attempt(setup());
        vi.stubEnv('DEMO_ACCOUNT_PASSWORD', SENTINEL);
      };
      const seedWithoutAuthSecret = async () => {
        vi.stubEnv('BETTER_AUTH_SECRET', '');
        await attempt(setup());
      };

      await readStoredHash(await seedTwice());
      await seedOverTakenAddress();
      await seedWithBreachedPassword();
      await seedWithUnreachableBreachCheck();
      await seedWithShortPassword();
      await seedWithoutPassword();
      await seedWithoutAuthSecret();

      expect(outputs.length).toBeGreaterThan(8);
      for (const text of [...outputs, ...logged]) {
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain(SENTINEL.slice(0, 10));
      }
    },
    SLOW * 2,
  );

  test('the password is read once, through env, and is no argument to another function', () => {
    const code = seedSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code.match(/DEMO_ACCOUNT_PASSWORD/g)).toHaveLength(1);
    expect(code).toContain('env.DEMO_ACCOUNT_PASSWORD');
    expect(code).not.toContain('process.env');

    const starts = [...code.matchAll(/ctx\.run(?:Mutation|Query|Action)\(/g)];
    expect(starts.length).toBeGreaterThan(3);
    for (const start of starts) {
      let depth = 0;
      let end = start.index;
      for (let i = start.index + start[0].length - 1; i < code.length; i++) {
        if (code[i] === '(') depth++;
        if (code[i] === ')') depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      expect(code.slice(start.index, end + 1).toLowerCase()).not.toContain('password');
    }
  });
});

describe('seed:demo accounts: the seeded invite', () => {
  test(
    'cannot be accepted, even by the invited address, with the stored hash or a guessed token',
    async () => {
      const t = setup();
      await run(t);
      const stored = (await appRows(t)).invites[0];
      if (!stored) throw new Error('no seeded invite');
      await signUp(t, INVITED, OTHER_PASSWORD);
      const invited = await as(t, INVITED);
      const memberships = (await appRows(t)).memberships.length;

      const guesses = [
        stored.tokenHash,
        '',
        'x'.repeat(43),
        INVITED,
        GULF_COAST,
        'coed-7v7-rec',
        'A'.repeat(43),
        'x'.repeat(129),
      ];
      for (const token of guesses) {
        expect(await t.query(api.invites.getByToken, { token })).toEqual({ status: 'invalid' });
        const failure = await invited.mutation(api.invites.accept, { token }).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure, `token ${token.slice(0, 12)}`).not.toBeNull();
      }
      const after = await appRows(t);
      expect(after.invites).toEqual([stored]);
      expect(after.memberships).toHaveLength(memberships);
      expect(await membershipsOf(t, INVITED)).toEqual([]);
    },
    SLOW,
  );
});

describe('seed:demo accounts: three runs at once', () => {
  test(
    'none throws, and the rows end one per address, membership, and invite',
    async () => {
      const t = setup();
      const results = await Promise.all([run(t), run(t), run(t)]);
      for (const result of results) {
        for (const code of Object.values(result.accounts)) {
          expect(['created', 'exists', 'conflict']).toContain(code);
        }
      }
      const users = await authRows(t, 'user');
      const accounts = await authRows(t, 'account');
      for (const email of Object.values(EMAILS)) {
        const user = users.filter((u) => u['email'] === email);
        expect(user).toHaveLength(1);
        expect(accounts.filter((a) => a['userId'] === user[0]?.['_id'])).toHaveLength(1);
      }
      expect((await run(t)).accounts).toEqual(ALL('exists'));
      const rows = await appRows(t);
      expect(rows.users).toHaveLength(3);
      expect(rows.memberships).toHaveLength(5);
      expect(rows.invites).toHaveLength(1);
    },
    SLOW * 2,
  );
});
