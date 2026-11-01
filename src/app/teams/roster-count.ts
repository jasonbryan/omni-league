export interface RosterCount {
  count: string;
  note: string;
  met: boolean;
}

const players = (count: number) => `${count} ${count === 1 ? 'player' : 'players'}`;

export function rosterCount(rostered: number, minimum: number): RosterCount {
  const met = rostered >= minimum;
  const count = rostered <= minimum ? `${rostered} of ${players(minimum)}` : players(rostered);
  const note = met
    ? `The roster meets the minimum of ${players(minimum)}.`
    : `${minimum - rostered} more needed to reach the minimum of ${players(minimum)}.`;
  return { count, note, met };
}
