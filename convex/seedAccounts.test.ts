/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import { isForbidden } from './lib/forbidden';
import { authUserIdByEmail } from './lib/authUsers';
import { hashInviteToken } from './lib/inviteToken';
import { deleteMembership } from './lib/memberships';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import { removeRosterEntry } from './lib/rosterWrites';
import schema from './schema';
import seedSource from './seed.ts?raw';
import { DEMO_LOGO_ORGANIZATION_SLUG, demoLogoBytes } from './seedAssets';
import { modules } from './test.setup';

const SITE_URL = 'http://localhost:4000';
const DOMAIN = 'demo.omni-league.test';
const EMAILS = {
  admin: `admin@${DOMAIN}`,
  organizer: `organizer@${DOMAIN}`,
  player: `player@${DOMAIN}`,
  captain: `captain@${DOMAIN}`,
  guardian: `guardian@${DOMAIN}`,
} as const;
const FICTIONAL_CAPTAINS = [
  `maya.chen@${DOMAIN}`,
  `jordan.reyes@${DOMAIN}`,
  `priya.patel@${DOMAIN}`,
] as const;
const FICTIONAL_FREE_AGENTS = [
  `sam.okoye@${DOMAIN}`,
  `lena.ortiz@${DOMAIN}`,
  `theo.grant@${DOMAIN}`,
] as const;
const PLACED_FREE_AGENT = `nia.brooks@${DOMAIN}`;
const REMOVED_PLAYER = `rio.santos@${DOMAIN}`;
/** The five demo accounts, the three fictional captains, the four fictional free agents, the removed player, and the four partners of the Labor Day Sand Slam teams. */
const USERS = 17;
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

let addresses = 0;

// IS_TEST is unset, so the per-IP limit is on; each request comes from its own address.
function freshAddress(): string {
  addresses += 1;
  return `10.${(addresses >> 16) & 255}.${(addresses >> 8) & 255}.${addresses & 255}`;
}

async function post(t: T, path: string, body: unknown) {
  const response = await t.fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: SITE_URL,
      'cf-connecting-ip': freshAddress(),
    },
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
    teams: await ctx.db.query('teams').collect(),
    rosterEntries: await ctx.db.query('rosterEntries').collect(),
    freeAgents: await ctx.db.query('freeAgents').collect(),
  }));
}

/** Each demo team of the season by name, with its captain's address and its roster entries' addresses. */
async function demoTeams(t: T) {
  return t.run(async (ctx) => {
    const season = (await ctx.db.query('seasons').collect()).find(
      (row) => row.slug === 'summer-2027' && row.minimumRosterSize === 4,
    );
    if (!season) throw new Error('demo season missing');
    const users = await ctx.db.query('users').collect();
    const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { numItems: 200, cursor: null },
    })) as { page: { _id: string; email: string }[] };
    const emailOf = (userId: string) => {
      const authUserId = users.find((user) => user._id === userId)?.authUserId;
      return page.find((authUser) => authUser._id === authUserId)?.email;
    };
    const entries = await ctx.db.query('rosterEntries').collect();
    const teams = (await ctx.db.query('teams').collect()).filter((t) => t.seasonId === season._id);
    return {
      teamCount: (await ctx.db.get('seasons', season._id))?.teamCount,
      teams: Object.fromEntries(
        teams.map((team) => [
          team.name,
          {
            captain: emailOf(team.captainUserId),
            rosterCount: team.rosterCount,
            roster: entries
              .filter((entry) => entry.teamId === team._id)
              .map((entry) => [emailOf(entry.userId), entry.status, entry.source]),
          },
        ]),
      ),
    };
  });
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
      const tournaments = [];
      for (const id of row.programIds ?? [])
        tournaments.push((await ctx.db.get('programs', id))?.slug);
      result.push({
        organization: organization?.slug,
        role: row.role,
        leagues,
        ...(tournaments.length > 0 && { tournaments }),
      });
    }
    return result.sort((a, b) => String(a.organization).localeCompare(String(b.organization)));
  });
}

async function refused(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (failure) {
    return isForbidden(failure) || String(failure).includes('Not allowed');
  }
  return false;
}

const ALL = (code: string) => ({
  admin: code,
  organizer: code,
  player: code,
  captain: code,
  guardian: code,
});

// An action's storage write can land in another function's transaction in convex-test: https://github.com/convex/convex-test/pull/151
async function seedDataWithLogo(t: T) {
  await t.mutation(internal.seed.insertDemoData, {});
  return t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([demoLogoBytes().slice()], { type: 'image/png' }));
    const organization = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', DEMO_LOGO_ORGANIZATION_SLUG))
      .unique();
    await ctx.db.patch('organizations', organization!._id, { logoStorageId: id });
    return id;
  });
}

async function logoFiles(t: T) {
  return t.run(async (ctx) => {
    const organization = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', DEMO_LOGO_ORGANIZATION_SLUG))
      .unique();
    const files = await ctx.db.system.query('_storage').collect();
    return { files: files.map((file) => file._id), logo: organization?.logoStorageId };
  });
}

const DATA = {
  organizations: 7,
  locations: 25,
  customLevels: 1,
  leagues: 46,
  seasons: 8,
  tournaments: 4,
  camps: 2,
};
const NO_BACKFILL = {
  organizations: 0,
  locations: 0,
  leagues: 0,
  teamCounts: 0,
  pendingInviteCounts: 0,
  waitlistCounts: 0,
  staffCounts: 0,
  staffInviteCounts: 0,
  draftLeagueCounts: 0,
};

describe('seed:demo accounts: a new deployment', () => {
  test(
    'creates the five accounts, which sign in with the password, and the demo teams',
    async () => {
      const t = setup();
      const result = await run(t);
      expect(result).toEqual({
        ...DATA,
        logos: 1,
        backfilled: NO_BACKFILL,
        memberships: 5,
        invites: 1,
        teams: 20,
        teamInvites: 4,
        freeAgents: 6,
        accounts: ALL('created'),
      });
      for (const email of Object.values(EMAILS)) {
        const answer = await signIn(t, email);
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(answer.json).toHaveProperty('token');
      }
      expect((await signIn(t, EMAILS.admin, OTHER_PASSWORD)).status).toBe(401);
      const { users } = await appRows(t);
      expect(users).toHaveLength(USERS);
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
        {
          organization: GULF_COAST,
          role: 'leagueOrganizer',
          leagues: ['sunday-reverse-coed-4s'],
          tournaments: ['gulf-coast-beach-open'],
        },
      ]);
      expect(await membershipsOf(t, EMAILS.player)).toEqual([]);
      expect(await membershipsOf(t, EMAILS.captain)).toEqual([]);
      const { memberships, invites, leagues, organizations } = await appRows(t);
      expect(memberships).toHaveLength(5);
      for (const organization of organizations) {
        const recount = memberships.filter((m) => m.organizationId === organization._id).length;
        expect(organization.staffCount, organization.slug).toBe(recount);
      }
      expect(invites).toHaveLength(1);
      for (const organization of organizations) {
        const recount = invites.filter(
          (invite) => invite.organizationId === organization._id && invite.status === 'pending',
        ).length;
        expect(organization.pendingInviteCount, organization.slug).toBe(recount);
      }
      const gulfCoast = organizations.find((o) => o.slug === GULF_COAST);
      expect(gulfCoast?.pendingInviteCount).toBe(1);
      const league = leagues.find(
        (l) => l.slug === 'coed-7v7-rec' && l.organizationId === gulfCoast?._id,
      );
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
      expect(labels).toContain('Men · 10v10 · D (Rec)');
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
      expect(staff.find((s) => s.email === EMAILS.organizer)?.tournamentNames).toEqual([
        'Gulf Coast Beach Open',
      ]);
      expect(
        (await admin.query(api.camps.listForOrganization, { organizationId: gulfCoast._id }))
          .map(({ name, status, minimumAge, maximumAge }) => [name, status, minimumAge, maximumAge])
          .sort(),
      ).toEqual([
        ['Fall Break Camp', 'draft', 10, 16],
        ['Junior Beach Volleyball Camp', 'draft', 9, 14],
      ]);
      const pending = await admin.query(api.invites.listPending, {
        organizationId: gulfCoast._id,
      });
      expect(pending).toMatchObject([
        { email: INVITED, role: 'leagueOrganizer', leagueNames: ['Coed 7v7 Rec'] },
      ]);

      const organizer = await as(t, EMAILS.organizer);
      expect(
        await refused(() =>
          organizer.query(api.camps.listForOrganization, { organizationId: gulfCoast._id }),
        ),
      ).toBe(true);
      expect(await organizer.query(api.organizations.listMine, {})).toEqual([
        {
          name: 'Gulf Coast Sport & Social',
          slug: GULF_COAST,
          role: 'leagueOrganizer',
          leagues: [{ name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' }],
          tournaments: [{ name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' }],
        },
      ]);
      expect(
        await organizer.query(api.tournaments.getForManagement, {
          orgSlug: GULF_COAST,
          tournamentSlug: 'gulf-coast-beach-open',
        }),
      ).toMatchObject({ slug: 'gulf-coast-beach-open', role: 'leagueOrganizer' });
      expect(
        await refused(() =>
          organizer.query(api.tournaments.getForManagement, {
            orgSlug: GULF_COAST,
            tournamentSlug: 'winter-doubles-classic',
          }),
        ),
      ).toBe(true);
      expect(
        await organizer.query(api.leagues.getOrganizerContext, {
          orgSlug: GULF_COAST,
          leagueSlug: 'sunday-reverse-coed-4s',
        }),
      ).toMatchObject({ slug: 'sunday-reverse-coed-4s', role: 'leagueOrganizer' });
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

describe('seed:demo accounts: the demo teams', () => {
  test(
    'puts four teams in sunday-reverse-coed-4s / summer-2027, Sand Sharks captained by captain@ with player@ joined by invite',
    async () => {
      const t = setup();
      await run(t);
      expect(await demoTeams(t)).toEqual({
        teamCount: 4,
        teams: {
          'Net Results': {
            captain: FICTIONAL_CAPTAINS[0],
            rosterCount: 1,
            roster: [
              [FICTIONAL_CAPTAINS[0], 'rostered', 'captain'],
              [REMOVED_PLAYER, 'removed', 'invite'],
            ],
          },
          'Block Party': {
            captain: FICTIONAL_CAPTAINS[1],
            rosterCount: 2,
            roster: [
              [FICTIONAL_CAPTAINS[1], 'rostered', 'captain'],
              [EMAILS.guardian, 'rostered', 'invite'],
            ],
          },
          'Dig Dynasty': {
            captain: FICTIONAL_CAPTAINS[2],
            rosterCount: 2,
            roster: [
              [FICTIONAL_CAPTAINS[2], 'rostered', 'captain'],
              [PLACED_FREE_AGENT, 'rostered', 'placement'],
            ],
          },
          'Sand Sharks': {
            captain: EMAILS.captain,
            rosterCount: 2,
            roster: [
              [EMAILS.captain, 'rostered', 'captain'],
              [EMAILS.player, 'rostered', 'invite'],
            ],
          },
        },
      });
      const captain = await as(t, EMAILS.captain);
      const slugs = {
        orgSlug: GULF_COAST,
        leagueSlug: 'sunday-reverse-coed-4s',
        seasonSlug: 'summer-2027',
      };
      const registration = await captain.query(api.seasons.getForRegistration, slugs);
      expect(registration?.team).toMatchObject({
        name: 'Sand Sharks',
        isCaptain: true,
        rosterCount: 2,
      });
      const teamId = registration?.team?.teamId ?? '';
      expect(await captain.query(api.teams.getForMember, { teamId })).toMatchObject({
        name: 'Sand Sharks',
        rosterCount: 2,
        roster: [
          { name: 'Demo Captain', isCaptain: true, isViewer: true },
          { name: 'Demo Player', isCaptain: false, isViewer: false },
        ],
      });
      const player = await as(t, EMAILS.player);
      expect((await player.query(api.seasons.getForRegistration, slugs))?.team).toMatchObject({
        name: 'Sand Sharks',
        isCaptain: false,
      });
      const { entry, sharks } = await t.run(async (ctx) => ({
        entry: (await ctx.db.query('rosterEntries').collect()).find(
          (row) => row.source === 'invite' && row.status === 'rostered' && row.seasonId,
        ),
        sharks: (await ctx.db.query('teams').collect()).find((row) => row.name === 'Sand Sharks'),
      }));
      expect(entry?.addedByUserId).toBe(sharks?.captainUserId);
      // Each fictional captain's password was random and discarded.
      for (const email of FICTIONAL_CAPTAINS) {
        expect((await signIn(t, email)).status).toBe(401);
      }
    },
    SLOW,
  );

  test(
    'puts four teams in gulf-coast-beach-open, Sand Crabs captained by player@, once',
    async () => {
      const t = setup();
      await run(t);
      const tournamentTeams = () =>
        t.run(async (ctx) => {
          const tournaments = await ctx.db.query('tournaments').collect();
          const programs = await ctx.db.query('programs').collect();
          const only = tournaments.find(
            (row) =>
              programs.find((program) => program._id === row.programId)?.slug ===
              'gulf-coast-beach-open',
          );
          const teams = (await ctx.db.query('teams').collect()).filter(
            (row) => row.tournamentId === only?._id,
          );
          const users = await ctx.db.query('users').collect();
          const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: { numItems: 200, cursor: null },
          })) as { page: { _id: string; email: string }[] };
          const emailOf = (userId: string) =>
            page.find(
              (authUser) => authUser._id === users.find((user) => user._id === userId)?.authUserId,
            )?.email;
          return {
            tournament: programs.find((program) => program._id === only?.programId)?.slug,
            teamCount: only?.teamCount,
            captains: Object.fromEntries(
              teams.map((team) => [team.name, [emailOf(team.captainUserId), team.rosterCount]]),
            ),
          };
        });
      expect(await tournamentTeams()).toEqual({
        tournament: 'gulf-coast-beach-open',
        teamCount: 4,
        captains: {
          'Sand Crabs': [EMAILS.player, 2],
          'Beach Bombers': [FICTIONAL_CAPTAINS[0], 1],
          'Set Point': [FICTIONAL_CAPTAINS[1], 1],
          'Spike Squad': [FICTIONAL_CAPTAINS[2], 1],
        },
      });
      await run(t);
      expect((await tournamentTeams()).teamCount).toBe(4);
    },
    SLOW,
  );

  test(
    'shows admin@ the full gulf-coast-king-of-the-beach with its four teams and one waiting team',
    async () => {
      const t = setup();
      await run(t);
      const slugs = { orgSlug: GULF_COAST, tournamentSlug: 'gulf-coast-king-of-the-beach' };
      const admin = await as(t, EMAILS.admin);
      expect(await admin.query(api.tournaments.getForManagement, slugs)).toMatchObject({
        status: 'published',
        maximumTeams: 4,
        teamCount: 4,
      });
      expect(await admin.query(api.waitlist.listForTournament, slugs)).toMatchObject({
        rows: [{ teamName: 'Sunrise Setters', captainName: 'Lena Ortiz' }],
        waitlistCount: 1,
      });
      const organizer = await as(t, EMAILS.organizer);
      await expect(organizer.query(api.waitlist.listForTournament, slugs)).rejects.toThrow();
    },
    SLOW,
  );

  test(
    'adds Sand Sharks on a later run once the captain@ account exists, and nothing after that',
    async () => {
      const t = setup();
      await t.mutation(internal.seed.insertDemoData, {});
      expect(await t.mutation(internal.seed.insertDemoTeams, { captains: [] })).toBe(0);
      const first = await run(t);
      expect(first.teams).toBe(20);
      vi.stubEnv('DEMO_ACCOUNT_PASSWORD', undefined);
      expect((await run(t)).teams).toBe(0);
      vi.stubEnv('DEMO_ACCOUNT_PASSWORD', PASSWORD);
      expect((await run(t)).teams).toBe(0);
      expect(Object.keys((await demoTeams(t)).teams)).toHaveLength(4);
    },
    SLOW,
  );

  test(
    'a second run leaves player@ on Sand Sharks once, with one accepted invite',
    async () => {
      const t = setup();
      await run(t);
      await run(t);
      expect((await demoTeams(t)).teams['Sand Sharks']).toEqual({
        captain: EMAILS.captain,
        rosterCount: 2,
        roster: [
          [EMAILS.captain, 'rostered', 'captain'],
          [EMAILS.player, 'rostered', 'invite'],
        ],
      });
      const invites = await t.run((ctx) => ctx.db.query('teamInvites').collect());
      expect(invites.filter((row) => row.tokenHash === 'demo-invite-player')).toMatchObject([
        { status: 'accepted' },
      ]);
    },
    SLOW,
  );

  test(
    'does not put player@ back on Sand Sharks after the entry is removed',
    async () => {
      const t = setup();
      await run(t);
      await t.run(async (ctx) => {
        const entry = (await ctx.db.query('rosterEntries').collect()).find(
          (row) => row.source === 'invite' && row.status === 'rostered' && row.seasonId,
        )!;
        await removeRosterEntry(ctx, entry, entry.addedByUserId);
      });
      await run(t);
      expect((await demoTeams(t)).teams['Sand Sharks']).toEqual({
        captain: EMAILS.captain,
        rosterCount: 1,
        roster: [
          [EMAILS.captain, 'rostered', 'captain'],
          [EMAILS.player, 'removed', 'invite'],
        ],
      });
    },
    SLOW,
  );

  test(
    'keeps one removed entry on Net Results, removed by its captain, once, which no one signs in as',
    async () => {
      const t = setup();
      await run(t);
      await run(t);
      expect((await demoTeams(t)).teams['Net Results']).toEqual({
        captain: FICTIONAL_CAPTAINS[0],
        rosterCount: 1,
        roster: [
          [FICTIONAL_CAPTAINS[0], 'rostered', 'captain'],
          [REMOVED_PLAYER, 'removed', 'invite'],
        ],
      });
      const { removed, netResults } = await t.run(async (ctx) => ({
        removed: (await ctx.db.query('rosterEntries').collect()).find(
          (row) => row.status === 'removed',
        ),
        netResults: (await ctx.db.query('teams').collect()).find(
          (row) => row.name === 'Net Results',
        ),
      }));
      expect(removed?.removedByUserId).toBe(netResults?.captainUserId);
      expect(removed?.removedAt).toEqual(expect.any(Number));
      expect((await signIn(t, REMOVED_PLAYER)).status).toBe(401);
    },
    SLOW,
  );

  test(
    'puts two pending invites with marker hashes on Sand Sharks, once, which no token opens',
    async () => {
      const t = setup();
      const first = await run(t);
      expect(first.teamInvites).toBe(4);
      const captain = await as(t, EMAILS.captain);
      const registration = await captain.query(api.seasons.getForRegistration, {
        orgSlug: GULF_COAST,
        leagueSlug: 'sunday-reverse-coed-4s',
        seasonSlug: 'summer-2027',
      });
      const teamId = registration?.team?.teamId;
      if (!teamId) throw new Error('Sand Sharks missing');
      const pending = await captain.query(api.teamInvites.listPending, { teamId });
      expect(pending.rows.map((row) => row.email)).toEqual([
        'devon.park@demo.omni-league.test',
        'kai.nakamura@demo.omni-league.test',
      ]);
      expect(pending.total).toBe(2);
      const rows = await t.run((ctx) => ctx.db.query('teamInvites').collect());
      const markers = rows.map((row) => row.tokenHash);
      expect(rows.map((row) => [row.tokenHash, row.status])).toEqual([
        ['demo-invite-1', 'pending'],
        ['demo-invite-2', 'pending'],
        ['demo-invite-player', 'accepted'],
        ['demo-invite-tournament-1', 'pending'],
        ['demo-invite-tournament-player', 'accepted'],
      ]);
      for (const marker of markers) expect(marker).not.toMatch(/^[0-9a-f]{64}$/);
      expect(await hashInviteToken('demo-invite-1')).toMatch(/^[0-9a-f]{64}$/);

      await captain.mutation(api.teamInvites.revoke, { inviteId: pending.rows[0].inviteId });
      expect((await run(t)).teamInvites).toBe(0);
      expect(await t.run((ctx) => ctx.db.query('teamInvites').collect())).toHaveLength(5);
    },
    SLOW,
  );

  test(
    'puts one pending invite and one accepted player on Sand Crabs, once, which player@ sees',
    async () => {
      const t = setup();
      await run(t);
      expect((await run(t)).teamInvites).toBe(0);
      const player = await as(t, EMAILS.player);
      const teams = await player.query(api.teams.listMine, {});
      const crabs = teams.find((team) => team.teamName === 'Sand Crabs');
      if (!crabs) throw new Error('Sand Crabs missing');
      expect(crabs).toMatchObject({ tournamentName: 'Gulf Coast Beach Open', rosterCount: 2 });
      const team = await player.query(api.teams.getForMember, { teamId: crabs.teamId });
      expect(team?.roster.map((row) => row.name)).toEqual([expect.any(String), 'Theo Grant']);
      const pending = await player.query(api.teamInvites.listPending, { teamId: crabs.teamId });
      expect(pending.rows.map((row) => row.email)).toEqual([`ari.silva@${DOMAIN}`]);
      expect(pending.total).toBe(1);
      const rows = await t.run(async (ctx) =>
        (await ctx.db.query('teamInvites').collect()).filter((row) =>
          row.tokenHash.startsWith('demo-invite-tournament'),
        ),
      );
      expect(rows.map((row) => [row.tokenHash, row.status])).toEqual([
        ['demo-invite-tournament-1', 'pending'],
        ['demo-invite-tournament-player', 'accepted'],
      ]);
      for (const row of rows) expect(row).not.toHaveProperty('seasonId');
      const entries = await t.run((ctx) => ctx.db.query('rosterEntries').collect());
      const theo = entries.filter(
        (entry) => entry.source === 'invite' && entry.teamId === crabs.teamId,
      );
      expect(theo).toHaveLength(1);
      expect(theo[0]).not.toHaveProperty('seasonId');
    },
    SLOW,
  );

  test(
    'gives an address someone else holds no team, and seeds the others',
    async () => {
      const t = setup();
      await signUp(t, EMAILS.captain, OTHER_PASSWORD);
      const result = await run(t);
      expect(result.accounts.captain).toBe('conflict');
      expect(result.teams).toBe(19);
      expect(Object.keys((await demoTeams(t)).teams).sort()).toEqual([
        'Block Party',
        'Dig Dynasty',
        'Net Results',
      ]);
    },
    SLOW,
  );
});

describe('seed:demo accounts: the demo guardian', () => {
  test(
    'puts guardian@’s minor on Block Party once, with counters that match a recount, shortened for other teams',
    async () => {
      const t = setup();
      await run(t);
      await run(t);
      const minors = await t.run(async (ctx) =>
        (await ctx.db.query('rosterEntries').collect()).filter(
          (entry) => entry.minorName !== undefined,
        ),
      );
      expect(minors).toMatchObject([{ minorName: 'Ava Lane', status: 'rostered' }]);
      const teams = await t.run((ctx) => ctx.db.query('teams').collect());
      const entries = await t.run((ctx) => ctx.db.query('rosterEntries').collect());
      for (const team of teams) {
        const rostered = entries.filter(
          (entry) => entry.teamId === team._id && entry.status === 'rostered',
        );
        expect({ team: team.name, count: team.rosterCount }).toEqual({
          team: team.name,
          count: rostered.length,
        });
      }

      const guardian = await as(t, EMAILS.guardian);
      const mine = await guardian.query(api.teams.listMine, {});
      expect(mine.map((row) => [row.teamName, row.role])).toEqual([['Block Party', 'guardian']]);
      const blockParty = mine[0].teamId;
      const own = await guardian.query(api.teams.getForMember, { teamId: blockParty });
      expect(own?.roster.find((row) => row.minor !== null)).toMatchObject({
        name: 'Ava Lane',
        minor: { guardianName: 'Demo Guardian' },
      });
      const captain = await as(t, EMAILS.captain);
      const opponent = await captain.query(api.teams.getForMember, { teamId: blockParty });
      expect(opponent?.roster.map((row) => row.name)).toContain('Ava L.');
      expect(JSON.stringify(opponent)).not.toContain('Lane');
      expect(JSON.stringify(opponent)).not.toContain('Demo Guardian');
    },
    SLOW,
  );
});

describe('seed:demo accounts: the demo free agents', () => {
  async function demoFreeAgents(t: T) {
    return t.run(async (ctx) => {
      const users = await ctx.db.query('users').collect();
      const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { numItems: 200, cursor: null },
      })) as { page: { _id: string; email: string }[] };
      const emailOf = (userId: string) => {
        const authUserId = users.find((user) => user._id === userId)?.authUserId;
        return page.find((authUser) => authUser._id === authUserId)?.email;
      };
      const rows = [];
      for (const row of await ctx.db.query('freeAgents').collect()) {
        const season = await ctx.db.get('seasons', row.seasonId);
        const league = season && (await ctx.db.get('leagues', season.leagueId));
        rows.push([emailOf(row.userId), `${league?.slug}/${season?.slug}`, row.status]);
      }
      return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    });
  }

  test(
    'three fictional free agents wait in sunday-reverse-coed-4s / summer-2027, one is placed there, and player@ waits in coed-7v7-rec / summer-2027 and in its ended past-season, once',
    async () => {
      const t = setup();
      await run(t);
      const expected = [
        [`lena.ortiz@${DOMAIN}`, 'sunday-reverse-coed-4s/summer-2027', 'waiting'],
        [PLACED_FREE_AGENT, 'sunday-reverse-coed-4s/summer-2027', 'placed'],
        [EMAILS.player, 'coed-7v7-rec/summer-2027', 'waiting'],
        [EMAILS.player, 'coed-7v7-rec/past-season', 'waiting'],
        [`sam.okoye@${DOMAIN}`, 'sunday-reverse-coed-4s/summer-2027', 'waiting'],
        [`theo.grant@${DOMAIN}`, 'sunday-reverse-coed-4s/summer-2027', 'waiting'],
      ];
      expect(await demoFreeAgents(t)).toEqual(expected);
      const player = await as(t, EMAILS.player);
      const registration = await player.query(api.seasons.getForRegistration, {
        orgSlug: GULF_COAST,
        leagueSlug: 'coed-7v7-rec',
        seasonSlug: 'summer-2027',
      });
      expect(registration).toMatchObject({ team: null, freeAgent: { status: 'waiting' } });
      const mine = await player.query(api.freeAgents.listMine, {});
      expect(mine.map((row) => row.seasonName).sort()).toEqual(['Past season', 'Summer 2027']);
      for (const email of [...FICTIONAL_FREE_AGENTS, PLACED_FREE_AGENT]) {
        expect((await signIn(t, email)).status).toBe(401);
      }
      const { rosterEntries } = await appRows(t);
      expect(rosterEntries).toHaveLength(31);

      expect((await run(t)).freeAgents).toBe(0);
      expect(await demoFreeAgents(t)).toEqual(expected);
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
        tournaments: 0,
        camps: 0,
        logos: 0,
        backfilled: NO_BACKFILL,
        memberships: 0,
        invites: 0,
        teams: 0,
        teamInvites: 0,
        freeAgents: 0,
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
      await t.run((ctx) => deleteMembership(ctx, gone));
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
        captain: 'created',
        guardian: 'created',
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
        captain: 'created',
        guardian: 'created',
      });
      const players = (await authRows(t, 'user')).filter((u) => u['email'] === EMAILS.player);
      expect(players).toHaveLength(1);
      expect((await authRows(t, 'account')).map((a) => a['userId'])).not.toContain(
        players[0]?.['_id'],
      );
      // One per sign-up: four demo accounts, the three fictional captains, the four fictional free agents, the removed player, and the four bracket partners.
      expect(await authRows(t, 'session')).toHaveLength(16);
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
        logos: 1,
        backfilled: NO_BACKFILL,
        memberships: 0,
        invites: 1,
        teams: 0,
        teamInvites: 0,
        freeAgents: 0,
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
      expect(result).toMatchObject({
        ...DATA,
        memberships: 0,
        invites: 1,
        teams: 0,
        teamInvites: 0,
        freeAgents: 0,
      });
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
    [
      'findFictionalDemoUser',
      (t) => t.query(internal.seed.findFictionalDemoUser, { email: FICTIONAL_CAPTAINS[0] }),
    ],
    ['insertDemoFreeAgents', (t) => t.mutation(internal.seed.insertDemoFreeAgents, { people: [] })],
    ['insertDemoTeams', (t) => t.mutation(internal.seed.insertDemoTeams, { captains: [] })],
    [
      'insertDemoTeamPlayer',
      (t) => t.mutation(internal.seed.insertDemoTeamPlayer, { authUserId: 'someone' }),
    ],
    [
      'insertDemoTournamentInvites',
      (t) => t.mutation(internal.seed.insertDemoTournamentInvites, { people: [] }),
    ],
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
      const logo = await seedDataWithLogo(t);
      expect(await authRows(t, 'user')).toEqual([]);
      const results = await Promise.all([run(t), run(t)]);
      for (const result of results) {
        expect(result.logos).toBe(0);
        for (const code of Object.values(result.accounts)) {
          expect(['created', 'exists', 'conflict']).toContain(code);
        }
      }
      expect(await logoFiles(t)).toEqual({ files: [logo], logo });
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
      expect(rows.users).toHaveLength(USERS);
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
      const logo = await seedDataWithLogo(t);
      expect(await authRows(t, 'user')).toEqual([]);
      const results = await Promise.all([run(t), run(t), run(t)]);
      for (const result of results) {
        expect(result.logos).toBe(0);
        for (const code of Object.values(result.accounts)) {
          expect(['created', 'exists', 'conflict']).toContain(code);
        }
      }
      expect(await logoFiles(t)).toEqual({ files: [logo], logo });
      const users = await authRows(t, 'user');
      const accounts = await authRows(t, 'account');
      for (const email of Object.values(EMAILS)) {
        const user = users.filter((u) => u['email'] === email);
        expect(user).toHaveLength(1);
        expect(accounts.filter((a) => a['userId'] === user[0]?.['_id'])).toHaveLength(1);
      }
      expect((await run(t)).accounts).toEqual(ALL('exists'));
      const rows = await appRows(t);
      expect(rows.users).toHaveLength(USERS);
      expect(rows.memberships).toHaveLength(5);
      expect(rows.invites).toHaveLength(1);
    },
    SLOW * 2,
  );
});
