import { registrationIsOpen } from '../../../convex/lib/registration';

export interface TeamForNextStep {
  teamId: string;
  teamName: string;
  leagueName: string;
  role: string;
  seasonStartDate: string;
  registrationDeadline: string;
  minimumRosterSize: number;
  rosterCount: number;
}

export interface NextStep {
  teamId: string;
  teamName: string;
  leagueName: string;
  playersNeeded: number;
  minimumRosterSize: number;
  registrationDeadline: string;
}

const byNameIgnoringCase = (a: string, b: string) =>
  a.localeCompare(b, 'en-US', { sensitivity: 'accent' });

export function nextStep(teams: readonly TeamForNextStep[], nowMs: number): NextStep | null {
  const [first] = teams
    .filter(
      (team) =>
        team.role === 'captain' &&
        team.rosterCount < team.minimumRosterSize &&
        registrationIsOpen(
          { startDate: team.seasonStartDate, registrationDeadline: team.registrationDeadline },
          nowMs,
        ),
    )
    .sort(
      (a, b) =>
        a.registrationDeadline.localeCompare(b.registrationDeadline) ||
        byNameIgnoringCase(a.teamName, b.teamName),
    );
  return first
    ? {
        teamId: first.teamId,
        teamName: first.teamName,
        leagueName: first.leagueName,
        playersNeeded: first.minimumRosterSize - first.rosterCount,
        minimumRosterSize: first.minimumRosterSize,
        registrationDeadline: first.registrationDeadline,
      }
    : null;
}
