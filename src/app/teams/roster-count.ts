export interface RosterCount {
  count: string;
  note: string;
  met: boolean;
  full: boolean;
}

const players = (count: number) => `${count} ${count === 1 ? 'player' : 'players'}`;

/** `maximum` is `undefined` when the season has no limit. */
export function rosterCount(rostered: number, minimum: number, maximum?: number): RosterCount {
  const met = rostered >= minimum;
  const full = maximum !== undefined && rostered >= maximum;
  const count = rostered <= minimum ? `${rostered} of ${players(minimum)}` : players(rostered);
  const toMinimum = met
    ? `The roster meets the minimum of ${players(minimum)}.`
    : `${minimum - rostered} more needed to reach the minimum of ${players(minimum)}.`;
  let note = toMinimum;
  if (maximum !== undefined) {
    note = full
      ? `The team is full: ${players(maximum)} is this season’s maximum.`
      : `${toMinimum} Up to ${players(maximum)}.`;
  }
  return { count, note, met, full };
}
