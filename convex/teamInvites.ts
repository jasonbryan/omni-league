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
import { requireTeamManager, requireUser } from './lib/access';
import { authUserIdByEmail } from './lib/authUsers';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { generateInviteToken, hashInviteToken } from './lib/inviteToken';
import { insertTeamInvite, revokeTeamInvite, rosteredEntryInSeason } from './lib/rosterWrites';
import {
  checkTeamInviteEmail,
  TEAM_INVITE_LIST_LIMIT,
  TEAM_INVITE_MESSAGES,
  type TeamInviteInputError,
} from './lib/teamInviteInput';

function refuse(error: TeamInviteInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

async function teamOf(ctx: Pick<QueryCtx, 'db'>, teamId: Id<'teams'>): Promise<Doc<'teams'>> {
  const team = await ctx.db.get('teams', teamId);
  if (!team) throw new Error('Not allowed');
  return team;
}

// An action: Convex seeds the randomness of queries and mutations, which does not suit a bearer
// secret.
// eslint-disable-next-line @convex-dev/require-access-control -- an action has no database: it turns away a caller with no identity, then insertPending authorizes the caller as the team's captain or an organizer of its league inside the transaction that writes the invite.
export const create = action({
  args: { teamId: v.id('teams'), email: v.string() },
  returns: v.object({
    inviteId: v.id('teamInvites'),
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteId: Id<'teamInvites'>; token: string; expiresAt: number }> => {
    // Before any token is made; `insertPending` does the real check.
    if (!(await ctx.auth.getUserIdentity())) throw new Error('Sign in required');
    const token = generateInviteToken();
    const tokenHash = await hashInviteToken(token);
    const { inviteId, expiresAt } = await ctx.runMutation(internal.teamInvites.insertPending, {
      ...args,
      tokenHash,
    });
    return { inviteId, token, expiresAt };
  },
});

async function isOnTeam(
  ctx: Pick<MutationCtx, 'db' | 'runQuery'>,
  team: Doc<'teams'>,
  email: string,
): Promise<boolean> {
  const authUserId = await authUserIdByEmail(ctx, email);
  if (!authUserId) return false;
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  if (!user) return false;
  const entry = await rosteredEntryInSeason(ctx, team.seasonId, user._id);
  return entry?.teamId === team._id;
}

// Someone on another team of the season is not refused here, so a captain learns nothing about
// other teams; accepting refuses them.
export const insertPending = internalMutation({
  args: { teamId: v.id('teams'), email: v.string(), tokenHash: v.string() },
  returns: v.object({ inviteId: v.id('teamInvites'), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const team = await teamOf(ctx, args.teamId);
    const user = await requireTeamManager(ctx, team);
    const season = await ctx.db.get('seasons', team.seasonId);
    if (season?.status !== 'published') throw new Error('Not allowed');

    const checked = checkTeamInviteEmail(args.email);
    if (!checked.ok) refuse(checked.error);
    const { email } = checked;
    if (await isOnTeam(ctx, team, email)) {
      refuse({
        field: 'email',
        code: 'alreadyOnTeam',
        message: TEAM_INVITE_MESSAGES.alreadyOnTeam(email),
      });
    }

    const expiresAt = Date.now() + INVITE_LIFETIME_MS;
    const inviteId = await insertTeamInvite(ctx, team, {
      email,
      tokenHash: args.tokenHash,
      expiresAt,
      invitedByUserId: user._id,
    });
    return { inviteId, expiresAt };
  },
});

export const revoke = mutation({
  args: { inviteId: v.id('teamInvites') },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    // Signed-in first, so an unknown id and another team's invite look alike.
    await requireUser(ctx);
    const invite = await ctx.db.get('teamInvites', inviteId);
    if (!invite) throw new Error('Not allowed');
    await requireTeamManager(ctx, await teamOf(ctx, invite.teamId));
    await revokeTeamInvite(ctx, inviteId);
    return null;
  },
});

export const listPending = query({
  args: { teamId: v.id('teams') },
  returns: v.object({
    rows: v.array(
      v.object({ inviteId: v.id('teamInvites'), email: v.string(), expiresAt: v.number() }),
    ),
    total: v.number(),
  }),
  handler: async (ctx, { teamId }) => {
    await requireUser(ctx);
    const team = await teamOf(ctx, teamId);
    await requireTeamManager(ctx, team);
    const invites = await ctx.db
      .query('teamInvites')
      .withIndex('by_teamId_and_status', (q) => q.eq('teamId', teamId).eq('status', 'pending'))
      .take(TEAM_INVITE_LIST_LIMIT);
    return {
      rows: invites.map((invite) => ({
        inviteId: invite._id,
        email: invite.email,
        expiresAt: invite.expiresAt,
      })),
      total: team.pendingInviteCount ?? 0,
    };
  },
});
