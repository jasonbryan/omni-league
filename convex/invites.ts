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
import { assignablePrograms } from './lib/assignedPrograms';
import { authEmailOf, authUserIdByEmail } from './lib/authUsers';
import {
  checkInviteEmail,
  checkInviteAssignments,
  INVITE_LIFETIME_MS,
  INVITE_MESSAGES,
  INVITE_RESTORE_WINDOW_MS,
  type InviteInputError,
  type InviteRestoreError,
  type InviteRevokeError,
} from './lib/inviteInput';
import { findUsableInvite } from './lib/inviteLookup';
import { insertPendingInvite, recountPendingInvites, setInviteStatus } from './lib/inviteWrites';
import { generateInviteToken, hashInviteToken, timingSafeEqual } from './lib/inviteToken';
import { insertMembership } from './lib/memberships';
import { roleValidator, type Role } from './lib/roles';

export const PENDING_INVITES_LIMIT = 200;

function refuse(error: InviteInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

// An action: Convex seeds the randomness of queries and mutations, which does not suit a bearer
// secret.
// eslint-disable-next-line @convex-dev/require-access-control -- an action has no database: it turns away a caller with no identity, then insertPending authorizes the caller as an org admin of the organization inside the transaction that writes the invite.
export const create = action({
  args: {
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    programIds: v.optional(v.array(v.id('programs'))),
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

async function checkInviteAllowed(
  ctx: Pick<MutationCtx, 'db' | 'runQuery'>,
  args: {
    organizationId: Id<'organizations'>;
    email: string;
    role: Role;
    leagueIds: Id<'leagues'>[];
    programIds?: Id<'programs'>[] | undefined;
  },
  invalidAssignment: () => never,
): Promise<{ email: string; leagueIds: Id<'leagues'>[]; programIds: Id<'programs'>[] }> {
  const checked = checkInviteEmail(args.email);
  if (!checked.ok) refuse(checked.error);
  const { email } = checked;

  const leagueIds = [...new Set(args.leagueIds)];
  const requestedProgramIds = [...new Set(args.programIds)];
  if (args.role === 'orgAdmin') {
    if (leagueIds.length > 0 || requestedProgramIds.length > 0) {
      throw new Error('An org admin invite carries no leagues or programs');
    }
  } else {
    // A caller that sends `programIds` offers tournaments, so its message names them.
    const assignmentsError = checkInviteAssignments(
      leagueIds.length,
      requestedProgramIds.length,
      args.programIds !== undefined,
    );
    if (assignmentsError) refuse(assignmentsError);
    for (const id of leagueIds) {
      const league = await ctx.db.get('leagues', id);
      if (league?.organizationId !== args.organizationId) invalidAssignment();
    }
    const programs = await assignablePrograms(ctx, args.organizationId, requestedProgramIds);
    if (programs.length !== requestedProgramIds.length) invalidAssignment();
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
  return { email, leagueIds, programIds: requestedProgramIds };
}

export const insertPending = internalMutation({
  args: {
    organizationId: v.id('organizations'),
    email: v.string(),
    role: roleValidator,
    leagueIds: v.array(v.id('leagues')),
    programIds: v.optional(v.array(v.id('programs'))),
    tokenHash: v.string(),
  },
  returns: v.object({ inviteId: v.id('invites'), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const { email, leagueIds, programIds } = await checkInviteAllowed(ctx, args, () => {
      throw new Error('Not allowed');
    });

    const expiresAt = Date.now() + INVITE_LIFETIME_MS;
    const inviteId = await insertPendingInvite(ctx, {
      organizationId: args.organizationId,
      email,
      role: args.role,
      leagueIds,
      ...(programIds.length > 0 && { programIds }),
      tokenHash: args.tokenHash,
      expiresAt,
    });
    return { inviteId, expiresAt };
  },
});

export const revoke = mutation({
  args: { inviteId: v.id('invites') },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    // Signed-in first, so an unknown id and another organization's invite look alike.
    await requireUser(ctx);
    const invite = await ctx.db.get('invites', inviteId);
    if (!invite) throw new Error('Not allowed');
    await requireOrgAdmin(ctx, invite.organizationId);
    if (invite.status !== 'pending') {
      throw new ConvexError({
        code: 'notPending',
        message: INVITE_MESSAGES.revokeNotPending,
      } satisfies InviteRevokeError);
    }
    await setInviteStatus(ctx, inviteId, { status: 'revoked', revokedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { inviteId: v.id('invites') },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    await requireUser(ctx);
    const invite = await ctx.db.get('invites', inviteId);
    if (!invite) throw new Error('Not allowed');
    await requireOrgAdmin(ctx, invite.organizationId);
    if (invite.status !== 'revoked') {
      throw new ConvexError({
        code: 'notRevoked',
        message: INVITE_MESSAGES.restoreNotRevoked,
      } satisfies InviteRestoreError);
    }
    if (invite.revokedAt === undefined) throw new Error('A revoked invite has no revokedAt');
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
    await setInviteStatus(ctx, inviteId, { status: 'pending', revokedAt: undefined });
    return null;
  },
});

export const pendingCount = query({
  args: { organizationId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const organization = await ctx.db.get('organizations', organizationId);
    return organization?.pendingInviteCount ?? (await recountPendingInvites(ctx, organizationId));
  },
});

export const listPending = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      inviteId: v.id('invites'),
      email: v.string(),
      role: roleValidator,
      leagueNames: v.array(v.string()),
      // Absent when the invite names no tournament.
      tournamentNames: v.optional(v.array(v.string())),
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
      const tournamentNames = (
        await assignablePrograms(ctx, organizationId, invite.programIds)
      ).map((program) => program.name);
      rows.push({
        inviteId: invite._id,
        email: invite.email,
        role: invite.role,
        leagueNames,
        ...(tournamentNames.length > 0 && { tournamentNames }),
        expiresAt: invite.expiresAt,
      });
    }
    return rows;
  },
});

// Never the address, an id, or the hash.
const inviteSummaryFields = {
  organizationName: v.string(),
  role: roleValidator,
  leagueNames: v.array(v.string()),
  // Absent when the invite names no tournament.
  tournamentNames: v.optional(v.array(v.string())),
};

// `invalid` does not tell an unknown, revoked, expired, or accepted token apart.
export type AcceptRefusal = 'invalid' | 'emailMismatch' | 'alreadyMember';

function refuseAccept(code: AcceptRefusal): never {
  throw new ConvexError({ code });
}

async function summarise(
  ctx: Pick<QueryCtx, 'db'>,
  invite: Doc<'invites'>,
): Promise<{
  organizationName: string;
  organizationSlug: string;
  leagueIds: Id<'leagues'>[];
  leagueNames: string[];
  leagues: { name: string; slug: string }[];
  programIds: Id<'programs'>[];
  tournaments: { name: string; slug: string }[];
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
  const programs = await assignablePrograms(ctx, invite.organizationId, invite.programIds);
  return {
    organizationName: organization?.name ?? '',
    organizationSlug: organization?.slug ?? '',
    leagueIds,
    leagueNames,
    leagues,
    programIds: programs.map((program) => program._id),
    tournaments: programs.map(({ name, slug }) => ({ name, slug })),
  };
}

// All unusable tokens answer alike, so the answer says nothing about which.
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
    const { organizationName, leagueNames, tournaments } = await summarise(ctx, invite);
    return {
      status: 'valid' as const,
      organizationName,
      role: invite.role,
      leagueNames,
      ...(tournaments.length > 0 && { tournamentNames: tournaments.map(({ name }) => name) }),
      expiresAt: invite.expiresAt,
    };
  },
});

export const accept = mutation({
  args: { token: v.string() },
  returns: v.object({
    ...inviteSummaryFields,
    organizationSlug: v.string(),
    leagues: v.array(v.object({ name: v.string(), slug: v.string() })),
    // Absent when the invite names no tournament.
    tournaments: v.optional(v.array(v.object({ name: v.string(), slug: v.string() }))),
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

    const {
      organizationName,
      organizationSlug,
      leagueIds,
      leagueNames,
      leagues,
      programIds,
      tournaments,
    } = await summarise(ctx, invite);
    const isOrgAdmin = invite.role === 'orgAdmin';
    await insertMembership(
      ctx,
      user._id,
      invite.organizationId,
      invite.role,
      isOrgAdmin ? [] : leagueIds,
      isOrgAdmin ? [] : programIds,
    );
    await setInviteStatus(ctx, invite._id, { status: 'accepted' });
    return {
      organizationName,
      organizationSlug,
      role: invite.role,
      leagueNames,
      leagues,
      ...(tournaments.length > 0 && {
        tournamentNames: tournaments.map(({ name }) => name),
        tournaments,
      }),
    };
  },
});
