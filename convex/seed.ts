import { v, type Infer } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server';
import { ADULT_CONFIRMATION_FIELD, createAuth } from './auth';
import { authUserIdByEmail } from './lib/authUsers';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { insertMembership } from './lib/memberships';
import { verifyPassword } from './lib/password';
import { PREVIEW_ORIGIN_PATTERN } from './lib/previewOrigin';
import type { Role } from './lib/roles';
import { findLeagueBySlugs } from './lib/seasonLookup';
import type { SeasonStatus } from './lib/seasonStatus';
import {
  backfilledValidator,
  backfillTenantFields,
  insertLeague,
  insertLocation,
  insertSeason,
  insertTenant,
  seasonSlugTaken,
  type NewSeason,
  type Tenant,
} from './lib/tenantWrites';

/**
 * The demo organizations. All names and addresses are fictional demo values. The first two are
 * the organizations of the approved mockup (design/mockups/60-organization-page.html, #73), kept
 * exactly as the mockup shows them: one with leagues and locations, one empty. Every sport has
 * leagues in at least two organizations, and some organizations run more than one sport.
 *
 * Later features add their demo rows here, under the same insert-only rule (hosting.md, Demo
 * data): never rename or remove an entry, because a renamed one is inserted again next to the old.
 *
 * Exported for `e2e/pwa.spec.ts` (#82), which opens these pages on a production build seeded by
 * `seed:demo`. A plain value, not a Convex function, so it adds nothing to the API.
 */
export const DEMO: readonly Tenant[] = [
  {
    organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
    locations: [
      { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
      { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
      { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
    ],
    leagues: [
      { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      { name: "Men's Over-30 11v11", sport: 'soccer', locations: ['Bayside Athletic Complex'] },
      {
        name: 'Sunday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
      },
      {
        name: 'Thursday Night Coed 2s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
      },
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      },
    ],
  },
  {
    organization: {
      name: 'Port Aransas Beach Volleyball Club',
      slug: 'port-aransas-beach-volleyball-club',
    },
    locations: [],
    leagues: [],
  },
  {
    organization: { name: 'Front Range Rec Sports', slug: 'front-range-rec-sports' },
    locations: [
      { name: 'Cottonwood Creek Fields', address: '1850 Cottonwood Creek Pkwy, Denver, CO 80219' },
      { name: 'Bluebird Softball Complex', address: '7720 Bluebird Ridge Rd, Aurora, CO 80016' },
      { name: 'Larkspur Turf Center', address: '455 Larkspur Mesa Dr, Lakewood, CO 80228' },
    ],
    leagues: [
      { name: 'Coed 6v6 Indoor', sport: 'soccer', locations: ['Larkspur Turf Center'] },
      { name: "Women's Sunday 11v11", sport: 'soccer', locations: ['Cottonwood Creek Fields'] },
      {
        name: 'Monday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Bluebird Softball Complex'],
      },
      {
        name: "Men's Modified Fast-Pitch",
        sport: 'softball',
        locations: ['Bluebird Softball Complex', 'Cottonwood Creek Fields'],
      },
    ],
  },
  {
    organization: { name: 'Lakeshore Sand League', slug: 'lakeshore-sand-league' },
    locations: [
      { name: 'Driftwood Beach Courts', address: '2600 Driftwood Shore Dr, Chicago, IL 60614' },
      { name: 'Harbor Point Sand Courts', address: '915 Harbor Point Ave, Evanston, IL 60201' },
    ],
    leagues: [
      {
        name: "Tuesday Women's 2s",
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts'],
      },
      {
        name: 'Saturday Coed 6s',
        sport: 'beachVolleyball',
        locations: ['Driftwood Beach Courts', 'Harbor Point Sand Courts'],
      },
      {
        name: "Competitive Men's 4s",
        sport: 'beachVolleyball',
        locations: ['Harbor Point Sand Courts'],
      },
    ],
  },
  {
    organization: { name: 'Saguaro Valley Softball', slug: 'saguaro-valley-softball' },
    locations: [
      { name: 'Saguaro Ridge Park', address: '3180 Saguaro Ridge Rd, Phoenix, AZ 85042' },
      { name: 'Mesquite Flats Diamonds', address: '640 Mesquite Flats Ln, Tempe, AZ 85281' },
    ],
    leagues: [
      {
        name: 'Friday Night Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Saguaro Ridge Park'],
      },
      { name: 'Senior 55+ Slow-Pitch', sport: 'softball', locations: ['Mesquite Flats Diamonds'] },
      {
        name: "Men's D Division Slow-Pitch",
        sport: 'softball',
        locations: ['Saguaro Ridge Park', 'Mesquite Flats Diamonds'],
      },
    ],
  },
];

/**
 * The demo seasons of demo leagues, by the organization's and the league's slug: the `fall-2027`
 * drafts (#125) and the `summer-2027` published seasons (#126), which later issues register into
 * (`sunday-reverse-coed-4s / summer-2027`). A season is a draft unless its entry says `published`.
 * The published ones have slugs #125 does not seed, because the seed is insert-only: on a reused
 * staging, where #125's seed already inserted the `fall-2027` drafts, a published season under the
 * same slug would never be inserted. Never rename or remove an entry (hosting.md, Demo data).
 *
 * A plain value, not a Convex function, so it adds nothing to the API.
 */
export const DEMO_SEASONS: readonly {
  organizationSlug: string;
  leagueSlug: string;
  season: NewSeason;
  status?: SeasonStatus;
}[] = [
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'sunday-reverse-coed-4s',
    season: {
      name: 'Fall 2027',
      slug: 'fall-2027',
      startDate: '2027-09-12',
      endDate: '2027-11-14',
      registrationDeadline: '2027-08-29',
      format: '4v4',
      minimumRosterSize: 4,
    },
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'coed-7v7-rec',
    season: {
      name: 'Fall 2027',
      slug: 'fall-2027',
      startDate: '2027-09-08',
      endDate: '2027-11-10',
      registrationDeadline: '2027-08-25',
      format: '7v7',
      minimumRosterSize: 7,
    },
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'sunday-reverse-coed-4s',
    season: {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-06',
      endDate: '2027-08-29',
      registrationDeadline: '2027-05-23',
      format: '4v4',
      minimumRosterSize: 4,
    },
    status: 'published',
  },
  {
    organizationSlug: 'gulf-coast-sport-social',
    leagueSlug: 'coed-7v7-rec',
    season: {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-02',
      endDate: '2027-08-25',
      registrationDeadline: '2027-05-19',
      format: '7v7',
      minimumRosterSize: 7,
    },
    status: 'published',
  },
];

/** Rows inserted by one run, per table, and the rows its backfill changed (#100). */
const resultValidator = v.object({
  organizations: v.number(),
  locations: v.number(),
  leagues: v.number(),
  seasons: v.number(),
  backfilled: backfilledValidator,
});

/**
 * Throws unless `PREVIEW_ORIGIN_PATTERN` is exactly this project's preview origin pattern. Every
 * preview and staging deployment has it as a Convex default preview variable (hosting.md), and
 * `scripts/check-deploy-env.mjs production` fails when production has it, so the seed cannot write
 * on production even when run from the dashboard or the CLI. The message holds no value.
 */
function assertPreviewDeployment(): void {
  if (env.PREVIEW_ORIGIN_PATTERN !== PREVIEW_ORIGIN_PATTERN) {
    throw new Error(
      'seed:demo refused: PREVIEW_ORIGIN_PATTERN on this deployment is not the preview origin ' +
        'pattern of convex/lib/previewOrigin.ts, so this is not a preview or staging deployment',
    );
  }
}

/** The id of the organization with this slug, inserting the organization when it is missing. */
async function ensureOrganization(
  ctx: MutationCtx,
  tenant: Tenant,
): Promise<{ id: Id<'organizations'>; inserted: boolean }> {
  const { slug } = tenant.organization;
  const existing = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
  if (existing) return { id: existing._id, inserted: false };
  // insertTenant validates the slug; the locations and leagues follow one by one below.
  const id = await insertTenant(ctx, {
    organization: tenant.organization,
    locations: [],
    leagues: [],
  });
  return { id, inserted: true };
}

/**
 * The organizations, locations, leagues, and seasons of the demo data, the first step of `seed:demo`
 * (`demo`, below), which every build of netlify.toml's `deploy-preview` and `branch-deploy` contexts
 * runs after the deploy environment check. The production context never runs it.
 *
 * Insert-only, per record: it inserts each demo organization (by slug), location (by name within
 * its organization), and league (by name within its organization, with its location links) only
 * when it is missing, through the shared writers, which keep the organization's counters. It
 * never deletes a row, and a second run inserts nothing. It returns the number of rows it inserted
 * per table, which the build log shows. It throws before reading or writing unless the deployment
 * is a preview or staging deployment (`assertPreviewDeployment`).
 *
 * It also inserts the demo seasons (`DEMO_SEASONS`: the `fall-2027` drafts, #125, and the
 * `summer-2027` published seasons, #126) of the demo leagues, by slug within the league, through
 * `insertSeason`. A season is inserted only when its league has none under the slug, so a season
 * that exists is never updated, whatever its status.
 *
 * Before inserting, it backfills the fields #100, #101, and #66 added on any row written before
 * them (`backfillTenantFields`, the only update it makes, on demo and other rows alike): `sortName`,
 * the counters, and `status` `published` on a league without one, before the recount that counts
 * only published leagues. It reports the changed rows as `backfilled`. Every demo league is inserted
 * `published`. #104 removes the backfill.
 */
export const insertDemoData = internalMutation({
  args: {},
  returns: resultValidator,
  handler: async (ctx) => {
    assertPreviewDeployment();
    const backfilled = await backfillTenantFields(ctx);
    const inserted = { organizations: 0, locations: 0, leagues: 0, seasons: 0 };
    for (const tenant of DEMO) {
      const organization = await ensureOrganization(ctx, tenant);
      const organizationId = organization.id;
      if (organization.inserted) inserted.organizations++;

      for (const location of tenant.locations) {
        const existing = await ctx.db
          .query('locations')
          .withIndex('by_organizationId_and_name', (q) =>
            q.eq('organizationId', organizationId).eq('name', location.name),
          )
          .first();
        if (existing) continue;
        await insertLocation(ctx, organizationId, location);
        inserted.locations++;
      }

      for (const league of tenant.leagues) {
        const existing = await ctx.db
          .query('leagues')
          .withIndex('by_organizationId_and_name', (q) =>
            q.eq('organizationId', organizationId).eq('name', league.name),
          )
          .first();
        if (existing) continue;
        // Links the league to its named locations, which exist by now; throws on an unknown one.
        await insertLeague(ctx, organizationId, league);
        inserted.leagues++;
      }
    }

    // The seasons last, so every demo league exists. A season is inserted when its league has none
    // under the slug, whatever that one's status; a league that is missing (a slug collision made
    // the stored slug differ) is skipped.
    for (const { organizationSlug, leagueSlug, season, status } of DEMO_SEASONS) {
      const found = await findLeagueBySlugs(ctx, { orgSlug: organizationSlug, leagueSlug });
      if (!found) continue;
      if (await seasonSlugTaken(ctx, found.league._id, season.slug)) continue;
      await insertSeason(ctx, found.league, season, status);
      inserted.seasons++;
    }
    return { ...inserted, backfilled };
  },
});

/** The reserved, non-routable domain (RFC 2606) of every demo account address. */
export const DEMO_ACCOUNT_DOMAIN = 'demo.omni-league.test';

const accountKeyValidator = v.union(
  v.literal('admin'),
  v.literal('organizer'),
  v.literal('player'),
);

type AccountKey = Infer<typeof accountKeyValidator>;

/** One membership of a demo account: the organization and the leagues assigned, by slug. */
interface DemoMembership {
  organizationSlug: string;
  role: Role;
  leagueSlugs: readonly string[];
}

/**
 * The demo accounts (#98), one per role, all with the password in `DEMO_ACCOUNT_PASSWORD`. Never
 * rename or remove an entry: an address is the account's identity. Later features add their own
 * rows to the accounts they show on (`captain@`, `guardian@`, and so on), under #230.
 *
 * A plain value, not a Convex function, so it adds nothing to the API.
 */
export const DEMO_ACCOUNTS: Readonly<
  Record<AccountKey, { email: string; name: string; memberships: readonly DemoMembership[] }>
> = {
  // Org admin of the organization with data, of the empty one, and of the softball one, so it sees
  // three organizations.
  admin: {
    email: `admin@${DEMO_ACCOUNT_DOMAIN}`,
    name: 'Demo Admin',
    memberships: [
      { organizationSlug: 'gulf-coast-sport-social', role: 'orgAdmin', leagueSlugs: [] },
      {
        organizationSlug: 'port-aransas-beach-volleyball-club',
        role: 'orgAdmin',
        leagueSlugs: [],
      },
      // Where #233's custom level "D" (Rec) shows (#236).
      { organizationSlug: 'saguaro-valley-softball', role: 'orgAdmin', leagueSlugs: [] },
    ],
  },
  // League organizer of one league only.
  organizer: {
    email: `organizer@${DEMO_ACCOUNT_DOMAIN}`,
    name: 'Demo Organizer',
    memberships: [
      {
        organizationSlug: 'gulf-coast-sport-social',
        role: 'leagueOrganizer',
        leagueSlugs: ['sunday-reverse-coed-4s'],
      },
    ],
  },
  // No membership: sees the public pages and `/app` as a player.
  player: { email: `player@${DEMO_ACCOUNT_DOMAIN}`, name: 'Demo Player', memberships: [] },
};

/** The pending staff invite on the demo staff list. Its token is discarded, so it cannot be accepted. */
const DEMO_INVITE = {
  organizationSlug: 'gulf-coast-sport-social',
  email: `invited@${DEMO_ACCOUNT_DOMAIN}`,
  role: 'leagueOrganizer',
  leagueSlugs: ['coed-7v7-rec'],
} as const;

/**
 * What `seed:demo` reports for one demo account. Codes only: never the password, a hash, or an
 * error message.
 */
const accountCodeValidator = v.union(
  v.literal('created'),
  v.literal('exists'),
  v.literal('conflict'),
  v.literal('skipped:unset'),
  v.literal('rejected:too_short'),
  v.literal('rejected:too_long'),
  v.literal('rejected:breached'),
  v.literal('rejected:check_unavailable'),
);

type AccountCode = Infer<typeof accountCodeValidator>;

const demoResultValidator = v.object({
  ...resultValidator.fields,
  memberships: v.number(),
  invites: v.number(),
  accounts: v.object({
    admin: accountCodeValidator,
    organizer: accountCodeValidator,
    player: accountCodeValidator,
  }),
});

type DemoResult = Infer<typeof demoResultValidator>;

/** The organization with this slug, or `null`. */
async function organizationBySlug(ctx: Pick<MutationCtx, 'db'>, slug: string) {
  return ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
}

/** The ids of the leagues with these slugs in the organization, or `null` when one is missing. */
async function leagueIdsBySlugs(
  ctx: Pick<MutationCtx, 'db'>,
  organizationId: Id<'organizations'>,
  slugs: readonly string[],
): Promise<Id<'leagues'>[] | null> {
  const ids: Id<'leagues'>[] = [];
  for (const slug of slugs) {
    const league = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', slug),
      )
      .unique();
    if (!league) return null;
    ids.push(league._id);
  }
  return ids;
}

/**
 * Adds the pending staff invite to the staff list of the demo organization (#98), unless the
 * address already has a pending invite there (an expired one counts, as in `invites.insertPending`).
 * It takes the hash of a token the action made and discarded: a mutation's randomness is seeded, so
 * the token is made in the action, and nothing can accept the invite. Returns the rows inserted.
 */
export const insertDemoInvite = internalMutation({
  args: { tokenHash: v.string() },
  returns: v.number(),
  handler: async (ctx, { tokenHash }) => {
    assertPreviewDeployment();
    const organization = await organizationBySlug(ctx, DEMO_INVITE.organizationSlug);
    if (!organization) return 0;
    const leagueIds = await leagueIdsBySlugs(ctx, organization._id, DEMO_INVITE.leagueSlugs);
    if (!leagueIds) return 0;
    const pending = await ctx.db
      .query('invites')
      .withIndex('by_organizationId_and_email_and_status', (q) =>
        q
          .eq('organizationId', organization._id)
          .eq('email', DEMO_INVITE.email)
          .eq('status', 'pending'),
      )
      .first();
    if (pending) return 0;
    await ctx.db.insert('invites', {
      organizationId: organization._id,
      email: DEMO_INVITE.email,
      role: DEMO_INVITE.role,
      leagueIds,
      tokenHash,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
      status: 'pending',
    });
    return 1;
  },
});

/**
 * Gives the demo account `account` (the auth user `authUserId`) the memberships it is listed with,
 * each only when the user has none in that organization, so a run never changes an existing role
 * and a deleted membership comes back. Takes the auth user id and a name, never the password.
 * Returns the rows inserted.
 */
export const grantDemoMemberships = internalMutation({
  args: { authUserId: v.string(), account: accountKeyValidator },
  returns: v.number(),
  handler: async (ctx, { authUserId, account }) => {
    assertPreviewDeployment();
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    if (!user) throw new Error('seed:demo found a demo account with no app user record');
    let inserted = 0;
    for (const membership of DEMO_ACCOUNTS[account].memberships) {
      const organization = await organizationBySlug(ctx, membership.organizationSlug);
      if (!organization) continue;
      const existing = await ctx.db
        .query('memberships')
        .withIndex('by_userId_and_organizationId', (q) =>
          q.eq('userId', user._id).eq('organizationId', organization._id),
        )
        .unique();
      if (existing) continue;
      const leagueIds = await leagueIdsBySlugs(ctx, organization._id, membership.leagueSlugs);
      if (!leagueIds) continue;
      await insertMembership(ctx, user._id, organization._id, membership.role, leagueIds);
      inserted++;
    }
    return inserted;
  },
});

/**
 * What the action needs to know about the account with this address: no such user, a user with no
 * `credential` account (another run is mid sign-up, or one failed half way), or the auth user id
 * and the stored password hash for `verifyPassword`. Reads only; takes no password, and its result
 * goes to `verifyPassword` and nowhere else.
 */
export const findDemoCredential = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.object({ status: v.literal('absent') }),
    v.object({ status: v.literal('noCredential') }),
    v.object({ status: v.literal('found'), authUserId: v.string(), hash: v.string() }),
  ),
  handler: async (ctx, { email }) => {
    assertPreviewDeployment();
    const authUserId = await authUserIdByEmail(ctx, email);
    if (!authUserId) return { status: 'absent' as const };
    // The component's generated return types are `any`.
    const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'account',
      where: [
        { field: 'userId', value: authUserId },
        { field: 'providerId', value: 'credential' },
      ],
    })) as { password?: string | null } | null;
    if (!account?.password) return { status: 'noCredential' as const };
    return { status: 'found' as const, authUserId, hash: account.password };
  },
});

/** An account's code, plus the auth user id when the account may be given its memberships. */
interface Outcome {
  code: AccountCode;
  authUserId?: string;
}

type SignUpOutcome =
  | { kind: 'created'; authUserId: string }
  | { kind: 'rejected'; code: AccountCode }
  | { kind: 'present' };

/** The Better Auth error code and status of `error`, or `null` when it is not a Better Auth error. */
function authErrorOf(error: unknown): { code?: string; status?: unknown } | null {
  if (typeof error !== 'object' || error === null) return null;
  if ((error as { name?: unknown }).name !== 'APIError') return null;
  const { body, status, statusCode } = error as {
    body?: { code?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const code = typeof body?.code === 'string' ? body.code : undefined;
  return { code, status: status ?? statusCode };
}

/**
 * Signs the account up through Better Auth, with the 18+ confirmation, and maps a failure by its
 * error code or status, never by message text (`better-auth` 1.6.33, `sign-up.mjs` and the
 * `haveIBeenPwned` plugin): the length and breach codes are `rejected`, a breach check that could
 * not run (status 500, no code) is `check_unavailable`, an address that already exists, or that a
 * concurrent run took during the create, is `present`, and anything else throws a message that
 * holds neither the password nor Better Auth's text.
 */
async function signUp(
  auth: ReturnType<typeof createAuth>,
  key: AccountKey,
  password: string,
): Promise<SignUpOutcome> {
  const { email, name } = DEMO_ACCOUNTS[key];
  try {
    // The 18+ field is this app's (convex/auth.ts), so Better Auth's body type does not list it.
    const body = { name, email, password, [ADULT_CONFIRMATION_FIELD]: true };
    const { user } = await auth.api.signUpEmail({ body });
    return { kind: 'created', authUserId: user.id };
  } catch (error) {
    const failure = authErrorOf(error);
    const code = failure?.code;
    if (code === 'PASSWORD_TOO_SHORT') return { kind: 'rejected', code: 'rejected:too_short' };
    if (code === 'PASSWORD_TOO_LONG') return { kind: 'rejected', code: 'rejected:too_long' };
    if (code === 'PASSWORD_COMPROMISED') return { kind: 'rejected', code: 'rejected:breached' };
    if (code === undefined && failure !== null) {
      if (failure.status === 'INTERNAL_SERVER_ERROR' || failure.status === 500) {
        return { kind: 'rejected', code: 'rejected:check_unavailable' };
      }
    }
    if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || code === 'FAILED_TO_CREATE_USER') {
      return { kind: 'present' };
    }
    const named = code !== undefined && /^[A-Z_]{1,60}$/.test(code) ? ` (${code})` : '';
    // eslint-disable-next-line preserve-caught-error -- the cause is dropped on purpose: only its constant code is named, so no message from Better Auth reaches the build log.
    throw new Error(`seed:demo could not create the ${key} demo account${named}`);
  }
}

/** The outcome for an address that exists: `exists` when its stored hash verifies, else `conflict`. */
async function checkExisting(
  found: { status: 'noCredential' } | { status: 'found'; authUserId: string; hash: string },
  password: string,
): Promise<Outcome> {
  if (found.status === 'noCredential') return { code: 'conflict' };
  const verified = await verifyPassword({ hash: found.hash, password });
  return verified ? { code: 'exists', authUserId: found.authUserId } : { code: 'conflict' };
}

/**
 * Makes sure one demo account exists with this password. An existing account is verified against
 * its stored hash (never by a sign-in, which counts toward the per-address throttle, #63), and is
 * never rewritten: a mismatch is `conflict` and gets no role.
 */
async function ensureAccount(
  ctx: ActionCtx,
  auth: ReturnType<typeof createAuth>,
  key: AccountKey,
  password: string,
): Promise<Outcome> {
  const { email } = DEMO_ACCOUNTS[key];
  const found = await ctx.runQuery(internal.seed.findDemoCredential, { email });
  if (found.status !== 'absent') return checkExisting(found, password);

  const signedUp = await signUp(auth, key, password);
  if (signedUp.kind === 'created') return { code: 'created', authUserId: signedUp.authUserId };
  if (signedUp.kind === 'rejected') return { code: signedUp.code };

  // Another run took the address between the lookup and the create.
  const again = await ctx.runQuery(internal.seed.findDemoCredential, { email });
  if (again.status === 'absent') {
    throw new Error(`seed:demo could not create the ${key} demo account and found none`);
  }
  return checkExisting(again, password);
}

/**
 * Demo data and demo login accounts for deploy previews and staging (#97, #98), run by `npx convex
 * run seed:demo --preview-name <name>` on every build of netlify.toml's `deploy-preview` and
 * `branch-deploy` contexts, after the deploy environment check. The production context never runs it.
 *
 * An action, because Better Auth's sign-up (`auth.api.signUpEmail`, as `testing:seedLeague` does)
 * needs one. In order, each step an internal function that checks the deployment itself
 * (`assertPreviewDeployment`):
 * 1. `insertDemoData`: the organizations, locations, leagues, and seasons, insert-only.
 * 2. `insertDemoInvite`: the pending staff invite, with the hash of a token made and discarded here.
 * 3. For each of `DEMO_ACCOUNTS`, the account: created through the sign-up, or found and verified,
 *    then given its memberships (`grantDemoMemberships`) unless it is a `conflict`.
 *
 * Returns the rows inserted per table, plus `accounts`, one code per account (`created`, `exists`,
 * `conflict`, `skipped:unset`, or `rejected:<reason>`), which the build log shows. A missing, too
 * short, too long, or breached password, or an unreachable breach check, creates no account and
 * does not fail the build; the data is still seeded. The password is read once, here, through the
 * typed `env`, and goes only to Better Auth and `verifyPassword`: never to another Convex function,
 * a result, an error, or a log.
 */
export const demo = internalAction({
  args: {},
  returns: demoResultValidator,
  handler: async (ctx): Promise<DemoResult> => {
    assertPreviewDeployment();
    const data = await ctx.runMutation(internal.seed.insertDemoData, {});
    const invites = await ctx.runMutation(internal.seed.insertDemoInvite, {
      tokenHash: await hashInviteToken(generateInviteToken()),
    });

    const password = env.DEMO_ACCOUNT_PASSWORD;
    const accounts: Record<AccountKey, AccountCode> = {
      admin: 'skipped:unset',
      organizer: 'skipped:unset',
      player: 'skipped:unset',
    };
    let memberships = 0;
    if (password !== undefined && password !== '') {
      const auth = createAuth(ctx);
      for (const key of ['admin', 'organizer', 'player'] as const) {
        const outcome = await ensureAccount(ctx, auth, key, password);
        accounts[key] = outcome.code;
        if (outcome.authUserId !== undefined) {
          memberships += await ctx.runMutation(internal.seed.grantDemoMemberships, {
            authUserId: outcome.authUserId,
            account: key,
          });
        }
      }
    }
    return { ...data, memberships, invites, accounts };
  },
});
