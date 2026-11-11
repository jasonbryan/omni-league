export interface AttentionTotal {
  total: number;
  capped: boolean;
}

interface AttentionTotals {
  draftSeasons: AttentionTotal;
  leaguesWithoutSeason: AttentionTotal;
  pendingInvites: AttentionTotal;
}

/** The invites are one item however many there are, so only the other two kinds make the count "n+". */
export function attentionCount(
  attention: AttentionTotals,
): { shown: string; spoken: string } | null {
  const total =
    attention.draftSeasons.total +
    attention.leaguesWithoutSeason.total +
    (attention.pendingInvites.total > 0 ? 1 : 0);
  if (total === 0) return null;
  // The leagues past the first 100 are never checked, so a capped league count can be exact; a capped draft count is at least one more.
  if (attention.draftSeasons.capped) {
    return { shown: `${total}+`, spoken: `more than ${total} items` };
  }
  if (attention.leaguesWithoutSeason.capped) {
    return { shown: `${total}+`, spoken: `${total} or more items` };
  }
  return { shown: String(total), spoken: `${total} ${total === 1 ? 'item' : 'items'}` };
}

export const CHECKED_LEAGUES_TEXT = 'Only the first 100 published leagues are checked.';

export function moreItemsText({ total, capped }: AttentionTotal, shown: number): string | null {
  const more = total - shown;
  return more > 0 ? `and ${more}${capped ? '+' : ''} more` : null;
}

export function invitesPendingText({ total, capped }: AttentionTotal): string {
  if (total === 1 && !capped) return '1 staff invite is pending';
  return `${total}${capped ? '+' : ''} staff invites are pending`;
}

/** The date is in the viewer's time zone, where the instant may fall on another day than it does in UTC. */
export function inviteExpiryText(expiresAt: number, nowMs: number, timeZone?: string): string {
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(
    expiresAt,
  );
  return `${expiresAt <= nowMs ? 'expired' : 'expires'} ${day}`;
}
