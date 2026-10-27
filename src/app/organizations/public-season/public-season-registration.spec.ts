import { registrationCard } from './public-season-registration';
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
    const later = { ...tied, name: 'Z', slug: 'z', startDate: '2027-09-20' };
    const earlier = { ...tied, name: 'Y', slug: 'y', startDate: '2027-09-12' };
    const sameStart = { ...tied, name: 'X', slug: 'x', startDate: '2027-09-12' };
    const now = at('2027-08-01T00:00:00Z');
    expect(registrationCard(upcoming(later, earlier), now)).toMatchObject({ next: { slug: 'y' } });
    expect(registrationCard(upcoming(earlier, sameStart, later), now)).toMatchObject({
      next: { slug: 'x' },
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
