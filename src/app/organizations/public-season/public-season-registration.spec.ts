import type { Id } from '../../../../convex/_generated/dataModel';
import { registrationCard, teamCard, type ViewerTeam } from './public-season-registration';
import { SUMMER_2027, without } from './testing/season-data';

const at = (iso: string) => Date.parse(iso);
const SUMMER = { ...SUMMER_2027, registrationDeadline: '2027-05-23' };
const FALL = {
  name: 'Fall 2027',
  slug: 'fall-2027',
  startDate: '2027-09-12',
  registrationDeadline: '2027-09-05',
};

describe('registrationCard phase', () => {
  it.each([
    ['2027-05-01T00:00:00Z', 'registrationOpen'],
    ['2027-05-30T00:00:00Z', 'registrationClosed'],
    ['2027-07-01T00:00:00Z', 'inProgress'],
    ['2027-09-01T00:00:00Z', 'ended'],
  ] as const)('at %s the phase is %s', (when, phase) => {
    expect(registrationCard(SUMMER, at(when))?.phase).toBe(phase);
  });
});

describe('registrationCard', () => {
  it('is open until the end of the deadline day at UTC-12, with the deadline as text', () => {
    expect(registrationCard(SUMMER, at('2027-05-24T11:59:59Z'))).toEqual({
      kind: 'open',
      phase: 'registrationOpen',
      closes: 'May 23, 2027',
    });
    expect(registrationCard(SUMMER, at('2027-05-24T12:00:00Z'))?.kind).toBe('closed');
  });

  it('is full while open when the season is full, with the waitlist and the deadline', () => {
    const full = { ...SUMMER, isFull: true, maxTeams: 2 };
    expect(registrationCard(full, at('2027-05-01T00:00:00Z'))).toEqual({
      kind: 'full',
      phase: 'registrationOpen',
      closes: 'May 23, 2027',
      note: 'Join the waitlist and an organizer offers you a place if one opens. Registration closes May 23, 2027.',
    });
    expect(registrationCard(full, at('2027-05-30T00:00:00Z'))?.kind).toBe('closed');
    expect(registrationCard({ ...SUMMER, isFull: false }, at('2027-05-01T00:00:00Z'))?.kind).toBe(
      'open',
    );
  });

  it('is closed from the start date, and says the season is underway', () => {
    expect(registrationCard(SUMMER, at('2027-06-06T12:00:00Z'))).toEqual({
      kind: 'closed',
      phase: 'inProgress',
      closedOn: 'May 23, 2027',
      note: 'This season is underway.',
      next: undefined,
    });
  });

  it('says when the season starts while registration is closed before the start', () => {
    expect(registrationCard(SUMMER, at('2027-05-30T00:00:00Z'))).toMatchObject({
      note: 'This season starts Jun 6, 2027.',
    });
  });

  it('says the season has ended after its end date', () => {
    expect(registrationCard(SUMMER, at('2027-09-01T00:00:00Z'))).toMatchObject({
      note: 'This season has ended.',
    });
  });

  it('links the open season with the soonest deadline, never the season on the page', () => {
    const later = {
      ...FALL,
      name: 'Winter 2028',
      slug: 'winter-2028',
      registrationDeadline: '2027-12-01',
    };
    const past = {
      ...FALL,
      name: 'Old',
      slug: 'old',
      startDate: '2027-01-10',
      registrationDeadline: '2027-01-01',
    };
    const league = {
      ...SUMMER,
      league: {
        ...SUMMER.league,
        upcomingSeasons: [later, SUMMER, FALL, past].map((season) => ({
          name: season.name,
          slug: season.slug,
          startDate: season.startDate,
          registrationDeadline: season.registrationDeadline,
        })),
      },
    };
    const card = registrationCard(league, at('2027-08-01T00:00:00Z'));
    expect(card).toMatchObject({ kind: 'closed', next: { name: 'Fall 2027', slug: 'fall-2027' } });
  });

  it('links the open season that starts first when two share a deadline, then the lower slug', () => {
    const upcoming = (...seasons: (typeof FALL)[]) => ({
      ...SUMMER,
      league: { ...SUMMER.league, upcomingSeasons: seasons },
    });
    const tied = { ...FALL, registrationDeadline: '2027-08-20' };
    const later = { ...tied, name: 'A', slug: 'a', startDate: '2027-09-20' };
    const earlier = { ...tied, name: 'C', slug: 'c', startDate: '2027-09-12' };
    const sameStart = { ...tied, name: 'B', slug: 'b', startDate: '2027-09-12' };
    const now = at('2027-08-01T00:00:00Z');
    expect(registrationCard(upcoming(later, earlier), now)).toMatchObject({ next: { slug: 'c' } });
    expect(registrationCard(upcoming(earlier, sameStart, later), now)).toMatchObject({
      next: { slug: 'b' },
    });
  });

  it('links nothing when no other season is open', () => {
    const league = {
      ...SUMMER,
      league: {
        ...SUMMER.league,
        upcomingSeasons: [
          {
            name: SUMMER.name,
            slug: SUMMER.slug,
            startDate: SUMMER.startDate,
            registrationDeadline: SUMMER.registrationDeadline,
          },
        ],
      },
    };
    expect(registrationCard(league, at('2027-06-10T00:00:00Z'))).toMatchObject({
      kind: 'closed',
      next: undefined,
    });
  });

  it('has no card for a saved copy that holds no deadline', () => {
    const saved = without(SUMMER, 'registrationDeadline');
    expect(registrationCard(saved, at('2027-05-01T00:00:00Z'))).toBeUndefined();
  });
});

describe('teamCard', () => {
  const SHARKS: ViewerTeam = {
    teamId: 'team_sharks' as Id<'teams'>,
    name: 'Sand Sharks',
    isCaptain: true,
    rosterCount: 3,
  };
  const OPEN = at('2027-05-01T00:00:00Z');

  it('names the team and its captain role, the roster against the minimum, and the invites still needed before the deadline', () => {
    expect(teamCard(SHARKS, SUMMER, OPEN)).toEqual({
      teamId: 'team_sharks',
      name: 'Sand Sharks',
      role: 'Captain · 3 of the 4 players needed',
      invite: 'Invite one more player before May 23, 2027 to reach the minimum.',
    });
  });

  it('counts the players still needed in figures beyond one', () => {
    expect(teamCard({ ...SHARKS, rosterCount: 1 }, SUMMER, OPEN)?.invite).toBe(
      'Invite 3 more players before May 23, 2027 to reach the minimum.',
    );
  });

  it('shows a player the roster with no invite line', () => {
    const player = { ...SHARKS, isCaptain: false, rosterCount: 2 };
    expect(teamCard(player, SUMMER, OPEN)).toMatchObject({
      role: 'Player · 2 of the 4 players needed',
      invite: undefined,
    });
  });

  it('shows a player on a team that meets the minimum the full roster and no invite line', () => {
    const player = { ...SHARKS, isCaptain: false, rosterCount: 4 };
    expect(teamCard(player, SUMMER, OPEN)).toMatchObject({
      role: 'Player · 4 of the 4 players needed',
      invite: undefined,
    });
  });

  it('shows no invite line to a captain whose team meets the minimum', () => {
    expect(teamCard({ ...SHARKS, rosterCount: 4 }, SUMMER, OPEN)).toMatchObject({
      role: 'Captain · 4 of the 4 players needed',
      invite: undefined,
    });
  });

  it('counts a roster above the minimum against it without overstating what is needed', () => {
    expect(teamCard({ ...SHARKS, rosterCount: 6 }, SUMMER, OPEN)?.role).toBe(
      'Captain · 6 players, at least 4 needed',
    );
  });

  it('shows no invite line once registration has closed', () => {
    expect(teamCard(SHARKS, SUMMER, at('2027-05-30T00:00:00Z'))).toMatchObject({
      role: 'Captain · 3 of the 4 players needed',
      invite: undefined,
    });
  });

  it('shows no invite line for a saved copy that holds no deadline', () => {
    expect(teamCard(SHARKS, without(SUMMER, 'registrationDeadline'), OPEN)?.invite).toBeUndefined();
  });
});
