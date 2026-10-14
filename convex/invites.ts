import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { requireOrgAdmin, requireUser } from './lib/access';
import { authEmailOf, authUserIdByEmail } from './lib/authUsers';
import {
  checkInviteEmail,
  checkInviteLeagues,
  INVITE_LIFETIME_MS,
  INVITE_MESSAGES,
  INVITE_RESTORE_WINDOW_MS,
  type InviteInputError,
  type InviteRestoreError,
} from './lib/inviteInput';
import { findUsableInvite } from './lib/inviteLookup';
import { generateInviteToken, hashInviteToken, timingSafeEqual } from './lib/inviteToken';
import { insertMembership } from './lib/memberships';
import { roleValidator, type Role } from './lib/roles';

/**
 * Pending invites `listPending` returns at most. The staff screen is one page with no paging
 * (#67), as for leagues (`ADMIN_LEAGUES_LIMIT`). Never taken from args.
 */
export const PENDING_INVITES_LIMIT = 200;

function refuse(error: InviteInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

/**
 * Invites someone to the organization's staff by email (#67). Org admins of the organization only.
 * Returns the invite and its **token**, which the caller turns into the link
 * `<origin>/invites/accept#<token>` and shows once: only the token's SHA-256 hash is stored, so
 * nothing can show it again, and to resend an org admin revokes the invite and creates a new one.
 *
 * An action, because the token is made here with `crypto.getRandomValues` (256 bits): Convex seeds
 * the randomness of queries and mutations, which does not suit a bearer secret. The checks and the
 * insert run in `insertPending`, one transaction that authorizes the caller itself (the caller's
 * identity passes through `ctx.runMutation`). Refusals about a field are a `ConvexError` whose data
 * is the `InviteInputError`: an empty or malformed email, a league organizer with no league, an
 * address of a current member, or one with a pending invite. Nothing sends email: no sending
 * domain exists before production (ADR 0011).
 */
// eslint-disable-next-line @convex-dev/require-access-control -- an action has no database: it turns away a caller with no identity, then insertPending authorizes the caller as an org admin of the organization inside the transaction that writes the invite.
export const create = action({
  args: {
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
  },
  returns: v.object({
    inviteId: v.id('invites'),
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteId: Id<'invites'>; token: string; expiresAt: number }> => {
    // Before any token is made; `insertPending` does the real check, as an org admin.
    if (!(await ctx.auth.getUserIdentity())) throw new Error('Sign in required');
    const token = generateInviteToken();
    const tokenHash = await hashInviteToken(token);
    const { inviteId, expiresAt } = await ctx.runMutation(internal.invites.insertPending, {
      ...args,
      tokenHash,
    });
    return { inviteId, token, expiresAt };
  },
});

/**
 * What `create` and `restore` both require before an invite is pending for an address, so the two
 * cannot drift: a well-formed email, the role's leagues (an org admin carries none; a
 * league organizer needs at least one, each in the organization, else `invalidLeague` throws), no
 * current member of the organization at that address (`alreadyMember`), and no other pending
 * invite to it (`alreadyInvited`, an expired one included). Returns the normalised address and the
 * de-duplicated leagues. A refusal about the address or the league count is a `ConvexError` whose
 * data is the `InviteInputError`.
 */
async function checkInviteAllowed(
  ctx: Pick<MutationCtx, 'db' | 'runQuery'>,
  args: {
    organizationId: Id<'organizations'>;
    email: string;
    role: Role;
    leagueIds: Id<'leagues'>[];
  },
  invalidLeague: () => never,
): Promise<{ email: string; leagueIds: Id<'leagues'>[] }> {
  const checked = checkInviteEmail(args.email);
  if (!checked.ok) refuse(checked.error);
  const { email } = checked;

  const leagueIds = [...new Set(args.leagueIds)];
  if (args.role === 'orgAdmin') {
    if (leagueIds.length > 0) throw new Error('An org admin invite carries no leagues');
  } else {
    const leaguesError = checkInviteLeagues(leagueIds.length);
    if (leaguesError) refuse(leaguesError);
    for (const id of leagueIds) {
      const league = await ctx.db.get('leagues', id);
      if (league?.organizationId !== args.organizationId) invalidLeague();
    }
  }

  const authUserId = await authUserIdByEmail(ctx, email);
  if (authUserId) {
    const user = await ctx.db
      .query('users')
      .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
      .unique();
    const member = user
      ? await ctx.db
          .query('memberships')
          .withIndex('by_userId_and_organizationId', (q) =>
            q.eq('userId', user._id).eq('organizationId', args.organizationId),
          )
          .unique()
      : null;
    if (member) {
      refuse({
        field: 'email',
        code: 'alreadyMember',
        message: INVITE_MESSAGES.alreadyMember(email),
      });
    }
  }

  const pending = await ctx.db
    .query('invites')
    .withIndex('by_organizationId_and_email_and_status', (q) =>
      q.eq('organizationId', args.organizationId).eq('email', email).eq('status', 'pending'),
    )
    .first();
  if (pending) {
    refuse({
      field: 'email',
      code: 'alreadyInvited',
      message: INVITE_MESSAGES.alreadyInvited(email),
    });
  }
  return { email, leagueIds };
}

/**
 * The transaction behind `create`: authorizes the caller (`requireOrgAdmin`), checks the email and
 * the role's leagues, refuses a current member and an address with a pending invite (an expired
 * one counts until it is revoked), and stores the invite as `pending` with the hash it was given,
 * expiring `INVITE_LIFETIME_MS` from now. A league of another organization is refused with
 * `Not allowed`, as the form never offers one.
 */
export const insertPending = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    tokenHash: v.string(),
  },
  returns: v.object({ inviteId: v.id('invites'), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const { email, leagueIds } = await checkInviteAllowed(ctx, args, () => {
      throw new Error('Not allowed');
    });

    const expiresAt = Date.now() + INVITE_LIFETIME_MS;
    const inviteId = await ctx.db.insert('invites', {
      organizationId: args.organizationId,
      email,
      role: args.role,
      leagueIds,
      tokenHash: args.tokenHash,
      expiresAt,
      status: 'pending',
    });
    return { inviteId, expiresAt };
  },
});

/**
 * Revokes a pending invite (#67), so its link no longer works. The organization comes from the
 * stored invite, never from args: an org admin of that organization only. Only a pending invite
 * can be revoked, an expired one included; a revoked or accepted one is refused.
 */
export const revoke = mutation({
  args: { inviteId: v.id('invites') },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    // Signed-in first, so an unknown id and another organization's invite look alike.
    await requireUser(ctx);
    const invite = await ctx.db.get('invites', inviteId);
    if (!invite) throw new Error('Not allowed');
    await requireOrgAdmin(ctx, invite.organizationId);
    if (invite.status !== 'pending') throw new Error('Only a pending invite can be revoked');
    await ctx.db.patch('invites', inviteId, { status: 'revoked', revokedAt: Date.now() });
    return null;
  },
});

/**
 * Undoes a revoke: sets a revoked invite back to `pending` with the same token hash and
 * expiry, so the link the org admin already sent works again. Org admins of the invite's
 * organization only, the organization taken from the stored invite. It refuses, writing nothing:
 * an invite that is not `revoked` or has no `revokedAt`, more than `INVITE_RESTORE_WINDOW_MS` after the revoke (`windowPassed`), an invite whose
 * `expiresAt` has passed (`expired`), and everything `create` would refuse for the same invite
 * (`checkInviteAllowed`: `alreadyMember`, `alreadyInvited`, and `leaguesGone` for a league that no
 * longer exists in the organization). Refusals with a code are a `ConvexError`; the window is
 * enforced here, never by the page.
 */
export const restore = mutation({
  args: { inviteId: v.id('invites') },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    await requireUser(ctx);
    const invite = await ctx.db.get('invites', inviteId);
    if (!invite) throw new Error('Not allowed');
    await requireOrgAdmin(ctx, invite.organizationId);
    if (invite.status !== 'revoked' || invite.revokedAt === undefined) {
      throw new Error('Only a revoked invite can be restored');
    }
    const now = Date.now();
    if (now - invite.revokedAt > INVITE_RESTORE_WINDOW_MS) {
      throw new ConvexError({
        code: 'windowPassed',
        message: INVITE_MESSAGES.restoreWindowPassed,
      } satisfies InviteRestoreError);
    }
    if (invite.expiresAt <= now) {
      throw new ConvexError({
        code: 'expired',
        message: INVITE_MESSAGES.restoreExpired,
      } satisfies InviteRestoreError);
    }
    await checkInviteAllowed(ctx, invite, () => {
      throw new ConvexError({
        code: 'leaguesGone',
        message: INVITE_MESSAGES.restoreLeaguesGone,
      } satisfies InviteRestoreError);
    });
    await ctx.db.patch('invites', inviteId, { status: 'pending', revokedAt: undefined });
    return null;
  },
});

/**
 * The organization's pending invites for its staff screen (#67): `{ inviteId, email, role,
 * leagueNames, expiresAt }`, oldest first, at most `PENDING_INVITES_LIMIT`. An invite whose
 * `expiresAt` has passed is still listed, because it is still pending and blocks a new invite to
 * its address. No token and no hash. Org admins of the organization only, because the rows hold
 * email addresses.
 */
export const listPending = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      inviteId: v.id('invites'),
      email: v.string(),
      role: roleValidator,
      leagueNames: v.array(v.string()),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const invites: Doc<'invites'>[] = await ctx.db
      .query('invites')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', organizationId).eq('status', 'pending'),
      )
      .take(PENDING_INVITES_LIMIT);
    const names = new Map<Id<'leagues'>, string | null>();
    const nameOf = async (id: Id<'leagues'>): Promise<string | null> => {
      if (!names.has(id)) {
        const league = await ctx.db.get('leagues', id);
        names.set(id, league?.organizationId === organizationId ? league.name : null);
      }
      return names.get(id) ?? null;
    };
    const rows = [];
    for (const invite of invites) {
      const leagueNames: string[] = [];
      for (const id of invite.leagueIds) {
        const name = await nameOf(id);
        if (name !== null) leagueNames.push(name);
      }
      rows.push({
        inviteId: invite._id,
        email: invite.email,
        role: invite.role,
        leagueNames,
        expiresAt: invite.expiresAt,
      });
    }
    return rows;
  },
});

/** What a visitor may see of an invite: never the address, an id, or the hash. */
const inviteSummaryFields = {
  organizationName: v.string(),
  role: roleValidator,
  leagueNames: v.array(v.string()),
};

/**
 * Why `accept` refused, as the `code` of its `ConvexError` data (#70): `invalid` for an unknown,
 * revoked, expired, or already accepted token (not told apart), `emailMismatch` when the caller's
 * account email is not the invited one, `alreadyMember` when the caller already has a membership
 * in the organization. Nothing is written for any of them.
 */
export type AcceptRefusal = 'invalid' | 'emailMismatch' | 'alreadyMember';

function refuseAccept(code: AcceptRefusal): never {
  throw new ConvexError({ code });
}

/**
 * The organization's name and slug and the invite's leagues that still exist in it (ids, and each
 * league's name and slug).
 */
async function summarise(
  ctx: Pick<QueryCtx, 'db'>,
  invite: Doc<'invites'>,
): Promise<{
  organizationName: string;
  organizationSlug: string;
  leagueIds: Id<'leagues'>[];
  leagueNames: string[];
  leagues: { name: string; slug: string }[];
}> {
  const organization = await ctx.db.get('organizations', invite.organizationId);
  const leagueIds: Id<'leagues'>[] = [];
  const leagueNames: string[] = [];
  const leagues: { name: string; slug: string }[] = [];
  for (const id of invite.leagueIds) {
    const league = await ctx.db.get('leagues', id);
    if (league?.organizationId === invite.organizationId) {
      leagueIds.push(id);
      leagueNames.push(league.name);
      leagues.push({ name: league.name, slug: league.slug });
    }
  }
  return {
    organizationName: organization?.name ?? '',
    organizationSlug: organization?.slug ?? '',
    leagueIds,
    leagueNames,
    leagues,
  };
}

/**
 * What the invite page shows for the token in the link (#70). Deliberately public: the token is
 * the bearer secret, and a visitor opens the link before they have an account. The token is hashed
 * here and looked up by `by_tokenHash`. A pending, unexpired invite answers `{ status: 'valid',
 * organizationName, role, leagueNames, expiresAt }`; an unknown, revoked, expired, or accepted one
 * answers exactly `{ status: 'invalid' }`, so the answer says nothing about which. No address, id,
 * or hash is returned.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (convex.md, Functions): the visitor has no account yet, the argument is a 256-bit bearer token that is hashed and looked up, and the answer holds no address, id, or hash.
export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({ status: v.literal('valid'), ...inviteSummaryFields, expiresAt: v.number() }),
    v.object({ status: v.literal('invalid') }),
  ),
  handler: async (ctx, { token }) => {
    const invite = await findUsableInvite(ctx, token, Date.now());
    if (!invite) return { status: 'invalid' as const };
    const { organizationName, leagueNames } = await summarise(ctx, invite);
    return {
      status: 'valid' as const,
      organizationName,
      role: invite.role,
      leagueNames,
      expiresAt: invite.expiresAt,
    };
  },
});

/**
 * Accepts the invite for the signed-in caller (#70). The caller's account email (kept by Better
 * Auth, never an argument) must be the invited address, compared in constant time; the invite must
 * be pending and unexpired; and the caller must not already be a member of the organization (one
 * membership per user per organization, and changing a role is a later slice). It then creates the
 * membership (an org admin, or a league organizer with the invite's leagues that still exist) and
 * marks the invite accepted in the same transaction. A concurrent second accept sees the invite
 * accepted and is refused, so the membership is never created twice. It returns the organization's
 * name and slug, the role, and the leagues granted (`leagues`: name and slug, for the page's "Open"
 * link, #212); `leagueNames` stays for the previous frontend and may go in a release at least 14
 * days after #212 ships. Only the caller who just accepted receives the slugs; `getByToken` still
 * shows a visitor none. Refusals are a
 * `ConvexError` whose data is `{ code: AcceptRefusal }`; a caller who is not signed in gets
 * `Sign in required`.
 */
export const accept = mutation({
  args: { token: v.string() },
  returns: v.object({
    ...inviteSummaryFields,
    organizationSlug: v.string(),
    leagues: v.array(v.object({ name: v.string(), slug: v.string() })),
  }),
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    const invite = await findUsableInvite(ctx, token, Date.now());
    if (!invite) refuseAccept('invalid');

    const accountEmail = (await authEmailOf(ctx, user.authUserId)) ?? '';
    if (accountEmail === '' || !timingSafeEqual(accountEmail, invite.email)) {
      refuseAccept('emailMismatch');
    }

    const existing = await ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) =>
        q.eq('userId', user._id).eq('organizationId', invite.organizationId),
      )
      .unique();
    if (existing) refuseAccept('alreadyMember');

    const { organizationName, organizationSlug, leagueIds, leagueNames, leagues } = await summarise(
      ctx,
      invite,
    );
    await insertMembership(
      ctx,
      user._id,
      invite.organizationId,
      invite.role,
      invite.role === 'orgAdmin' ? [] : leagueIds,
    );
    await ctx.db.patch('invites', invite._id, { status: 'accepted' });
    return { organizationName, organizationSlug, role: invite.role, leagueNames, leagues };
  },
});
