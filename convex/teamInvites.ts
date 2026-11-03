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
import { authEmailOf, authUserIdByEmail } from './lib/authUsers';
import { INVITE_LIFETIME_MS } from './lib/inviteInput';
import { findUsableTeamInvite } from './lib/inviteLookup';
import { generateInviteToken, hashInviteToken, timingSafeEqual } from './lib/inviteToken';
import { checkMinorName } from './lib/minorName';
import {
  acceptTeamInvite,
  adultEntryInSeason,
  insertTeamInvite,
  revokeTeamInvite,
} from './lib/rosterWrites';
import {
  checkTeamInviteEmail,
  TEAM_INVITE_LIST_LIMIT,
  TEAM_INVITE_MESSAGES,
  type TeamInviteAcceptCode,
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
  const entry = await adultEntryInSeason(ctx, team.seasonId, user._id);
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

// All unusable tokens answer alike, so the answer says nothing about which.
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (convex.md, Functions): the visitor has no account yet, the argument is a 256-bit bearer token that is hashed and looked up, and the answer holds no address, id, hash, captain, or roster.
export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      status: v.literal('valid'),
      teamName: v.string(),
      seasonName: v.string(),
      leagueName: v.string(),
      organizationName: v.string(),
      expiresAt: v.number(),
    }),
    v.object({ status: v.literal('invalid') }),
  ),
  handler: async (ctx, { token }) => {
    const found = await findUsableTeamInvite(ctx, token, Date.now());
    if (!found) return { status: 'invalid' as const };
    const { invite, team, season } = found;
    const league = await ctx.db.get('leagues', team.leagueId);
    const organization = await ctx.db.get('organizations', team.organizationId);
    if (!league || !organization) return { status: 'invalid' as const };
    return {
      status: 'valid' as const,
      teamName: team.name,
      seasonName: season.name,
      leagueName: league.name,
      organizationName: organization.name,
      expiresAt: invite.expiresAt,
    };
  },
});

function refuseAccept(code: Extract<TeamInviteAcceptCode, 'invalid' | 'emailMismatch'>): never {
  throw new ConvexError({ code });
}

/** `joinSelf` and `minorName` are optional, so a frontend that sends only `token` keeps joining the caller. */
export const accept = mutation({
  args: { token: v.string(), joinSelf: v.optional(v.boolean()), minorName: v.optional(v.string()) },
  returns: v.object({
    teamId: v.id('teams'),
    teamName: v.string(),
    seasonName: v.string(),
    captainName: v.string(),
    joinedSelf: v.boolean(),
    minorName: v.union(v.null(), v.string()),
  }),
  handler: async (ctx, { token, joinSelf = true, minorName: enteredMinorName }) => {
    const user = await requireUser(ctx);
    let minorName: string | null = null;
    if (enteredMinorName !== undefined) {
      const checked = checkMinorName(enteredMinorName);
      if (!checked.ok) throw new ConvexError({ ...checked.error });
      minorName = checked.name;
    }
    const found = await findUsableTeamInvite(ctx, token, Date.now());
    if (!found) refuseAccept('invalid');
    const { invite, team, season } = found;

    const accountEmail = (await authEmailOf(ctx, user.authUserId)) ?? '';
    if (accountEmail === '' || !timingSafeEqual(accountEmail, invite.email)) {
      refuseAccept('emailMismatch');
    }

    // The writer refuses this too; here the refusal also carries the id, so the page links to the
    // caller's own team.
    const entry = joinSelf ? await adultEntryInSeason(ctx, team.seasonId, user._id) : null;
    if (entry?.teamId === team._id) {
      throw new ConvexError({
        code: 'alreadyOnTeam' satisfies TeamInviteAcceptCode,
        teamName: team.name,
        teamId: team._id,
      });
    }

    await acceptTeamInvite(ctx, invite._id, user._id, { joinSelf, minorName });
    const captain = await ctx.db.get('users', team.captainUserId);
    return {
      teamId: team._id,
      teamName: team.name,
      seasonName: season.name,
      captainName: captain?.name ?? '',
      joinedSelf: joinSelf,
      minorName,
    };
  },
});
