export interface RosterProgress {
  text: string;
  percent: number;
  met: boolean;
}

export function rosterProgress(rosterCount: number, minimumRosterSize: number): RosterProgress {
  const met = rosterCount >= minimumRosterSize;
  return {
    text:
      rosterCount > minimumRosterSize
        ? `${rosterCount} players`
        : `${rosterCount} of ${minimumRosterSize} needed`,
    percent: minimumRosterSize > 0 ? Math.min(100, (rosterCount / minimumRosterSize) * 100) : 100,
    met,
  };
}
