// Finding a staff invite by the token a visitor presents (#70). The token is the bearer secret: it
// is hashed here and only the hash is looked up (`by_tokenHash`), so nothing stored or logged can
// open an invite. Shared by `invites.getByToken` and `invites.accept`.
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { hashInviteToken, MAX_INVITE_TOKEN_LENGTH, timingSafeEqual } from './inviteToken';

/**
 * The invite that `token` opens, or `null` for an unknown token and for one that cannot be used:
 * revoked, accepted, or past its expiry (`now` is the time of the call). The cases are not told
 * apart, so a visitor learns only that the link does not work. The stored hash is compared with
 * the computed one in constant time, although the index has already matched them.
 */
export async function findUsableInvite(
  ctx: Pick<QueryCtx, 'db'>,
  token: string,
  now: number,
): Promise<Doc<'invites'> | null> {
  if (token === '' || token.length > MAX_INVITE_TOKEN_LENGTH) return null;
  const tokenHash = await hashInviteToken(token);
  const invite = await ctx.db
    .query('invites')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .first();
  if (!invite || !timingSafeEqual(invite.tokenHash, tokenHash)) return null;
  if (invite.status !== 'pending' || invite.expiresAt <= now) return null;
  return invite;
}
