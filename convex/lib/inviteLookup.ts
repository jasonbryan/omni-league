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

export interface UsableTeamInvite {
  invite: Doc<'teamInvites'>;
  team: Doc<'teams'>;
  season: Doc<'seasons'>;
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
  const season = await ctx.db.get('seasons', invite.seasonId);
  if (season?.status !== 'published') return null;
  const team = await ctx.db.get('teams', invite.teamId);
  if (!team) return null;
  return { invite, team, season };
}
