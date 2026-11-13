import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { hashInviteToken, MAX_INVITE_TOKEN_LENGTH, timingSafeEqual } from './inviteToken';

export async function findUsableInvite(
  ctx: Pick<QueryCtx, 'db'>,
  token: string,
  now: number,
): Promise<Doc<'invites'> | null> {
  if (token === '' || token.length > MAX_INVITE_TOKEN_LENGTH) return null;
  // Only the hash is looked up, so nothing stored or logged can open an invite.
  const tokenHash = await hashInviteToken(token);
  const invite = await ctx.db
    .query('invites')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .first();
  // Constant-time, although the index has already matched the hashes.
  if (!invite || !timingSafeEqual(invite.tokenHash, tokenHash)) return null;
  if (invite.status !== 'pending' || invite.expiresAt <= now) return null;
  return invite;
}

export type TeamParent =
  | { kind: 'season'; season: Doc<'seasons'> }
  | { kind: 'tournament'; tournament: Doc<'tournaments'>; program: Doc<'programs'> };

export function teamParentName(parent: TeamParent): string {
  return parent.kind === 'season' ? parent.season.name : parent.program.name;
}

export async function publishedTeamParent(
  ctx: Pick<QueryCtx, 'db'>,
  team: Doc<'teams'>,
): Promise<TeamParent | null> {
  if (team.tournamentId !== undefined) {
    const tournament = await ctx.db.get('tournaments', team.tournamentId);
    const program = tournament && (await ctx.db.get('programs', tournament.programId));
    return tournament && program?.status === 'published'
      ? { kind: 'tournament', tournament, program }
      : null;
  }
  const season = team.seasonId ? await ctx.db.get('seasons', team.seasonId) : null;
  return season?.status === 'published' ? { kind: 'season', season } : null;
}

export interface UsableTeamInvite {
  invite: Doc<'teamInvites'>;
  team: Doc<'teams'>;
  parent: TeamParent;
}

/** A staff token finds nothing here: staff and team invites are separate tables. */
export async function findUsableTeamInvite(
  ctx: Pick<QueryCtx, 'db'>,
  token: string,
  now: number,
): Promise<UsableTeamInvite | null> {
  if (token === '' || token.length > MAX_INVITE_TOKEN_LENGTH) return null;
  const tokenHash = await hashInviteToken(token);
  const invite = await ctx.db
    .query('teamInvites')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .first();
  // Constant-time, although the index has already matched the hashes.
  if (!invite || !timingSafeEqual(invite.tokenHash, tokenHash)) return null;
  if (invite.status !== 'pending' || invite.expiresAt <= now) return null;
  const team = await ctx.db.get('teams', invite.teamId);
  if (!team) return null;
  const parent = await publishedTeamParent(ctx, team);
  return parent && { invite, team, parent };
}
