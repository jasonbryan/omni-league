import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, mutation, query } from './_generated/server';
import { requireOrgAdmin, requireUser } from './lib/access';
import { authUserIdByEmail } from './lib/authUsers';
import {
  checkInviteEmail,
  checkInviteLeagues,
  INVITE_LIFETIME_MS,
  INVITE_MESSAGES,
  type InviteInputError,
} from './lib/inviteInput';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { roleValidator } from './lib/roles';

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
        if (league?.organizationId !== args.organizationId) throw new Error('Not allowed');
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
    await ctx.db.patch('invites', inviteId, { status: 'revoked' });
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
