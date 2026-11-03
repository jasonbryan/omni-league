export interface TeamRowLines {
  roster: string;
  belowMinimum: boolean;
  /** `null` with no pending invite, so the row leaves the line out. */
  invites: string | null;
}

const players = (count: number) => `${count} ${count === 1 ? 'player' : 'players'}`;

export function teamRowLines(
  rosterCount: number,
  minimumRosterSize: number,
  pendingInviteCount: number,
): TeamRowLines {
  const belowMinimum = rosterCount < minimumRosterSize;
  const roster = belowMinimum
    ? `${rosterCount} of ${players(minimumRosterSize)} · ${minimumRosterSize - rosterCount} more needed`
    : rosterCount === minimumRosterSize
      ? `${rosterCount} of ${players(minimumRosterSize)}`
      : `${players(rosterCount)} · minimum ${minimumRosterSize}`;
  const invites =
    pendingInviteCount === 0
      ? null
      : `${pendingInviteCount} pending ${pendingInviteCount === 1 ? 'invite' : 'invites'}`;
  return { roster, belowMinimum, invites };
}
