import { buttonVariants } from '../ui/button/hlm-button';
import {
  OPEN_BADGE,
  OUTLINE_BADGE,
  REGISTER_BUTTON,
  REGISTER_BUTTON_LARGE,
  closesText,
  leagueSeasonStatus,
  nextSeason,
  openSeasonsOf,
  type LeagueRowSeason,
} from './season-status';

const season = (slug: string, start: string, end: string, deadline: string): LeagueRowSeason => ({
  name: slug.toUpperCase(),
  slug,
  startDate: start,
  endDate: end,
  registrationDeadline: deadline,
});

// 18:00 UTC is 06:00 on the date at UTC-12.
const noon = (date: string) => Date.parse(`${date}T18:00:00Z`);

const ENDED = season('ended', '2026-01-01', '2026-03-01', '2025-12-15');
const CURRENT = season('current', '2026-09-01', '2026-12-01', '2026-08-15');
const NEXT = season('next', '2027-06-01', '2027-08-30', '2027-05-19');
const LATER = season('later', '2027-09-12', '2027-11-14', '2027-08-29');

describe('nextSeason', () => {
  it('is the earliest-starting season that has not ended', () => {
    expect(nextSeason([LATER, NEXT, CURRENT, ENDED], noon('2026-10-27'))?.slug).toBe('current');
    expect(nextSeason([LATER, NEXT, ENDED], noon('2026-10-27'))?.slug).toBe('next');
  });

  it('is none when every season has ended or there are none', () => {
    expect(nextSeason([ENDED], noon('2026-10-27'))).toBeUndefined();
    expect(nextSeason([], noon('2026-10-27'))).toBeUndefined();
  });
});

describe('leagueSeasonStatus', () => {
  it('names an open season with its closing date', () => {
    expect(leagueSeasonStatus([NEXT], noon('2027-03-01'))).toEqual({
      badge: 'Registration open',
      open: true,
      text: 'NEXT · closes May 19',
    });
  });

  it('names a season whose registration closed', () => {
    expect(leagueSeasonStatus([NEXT], noon('2027-05-25'))).toEqual({
      badge: 'Registration closed',
      open: false,
      text: 'NEXT',
    });
  });

  it('names a season in progress', () => {
    expect(leagueSeasonStatus([CURRENT, ENDED], noon('2026-10-27'))).toEqual({
      badge: 'In progress',
      open: false,
      text: 'CURRENT',
    });
  });

  it('says there is no upcoming season when only ended seasons remain, and when there are none', () => {
    const none = { badge: null, open: false, text: 'No upcoming season' };
    expect(leagueSeasonStatus([ENDED], noon('2026-10-27'))).toEqual(none);
    expect(leagueSeasonStatus([], noon('2026-10-27'))).toEqual(none);
  });

  it('says nothing for a saved copy made before rows held their seasons', () => {
    expect(leagueSeasonStatus(undefined, noon('2026-10-27'))).toBeUndefined();
  });

  it('moves a season from open to closed as the clock passes its deadline', () => {
    expect(leagueSeasonStatus([NEXT], noon('2027-05-19'))?.badge).toBe('Registration open');
    expect(leagueSeasonStatus([NEXT], noon('2027-05-20'))?.badge).toBe('Registration closed');
  });
});

describe('openSeasonsOf', () => {
  const card = (slug: string, start: string, deadline: string, league = 'Alpha') => ({
    name: slug,
    slug,
    startDate: start,
    endDate: '2027-12-31',
    registrationDeadline: deadline,
    minimumRosterSize: 4,
    league: { name: league, slug: league.toLowerCase(), sportName: 'Soccer', locationNames: [] },
  });

  it('keeps the seasons that are open, soonest deadline first', () => {
    const rows = [
      card('late', '2027-06-01', '2027-05-30'),
      card('past', '2027-06-01', '2027-04-01'),
      card('soon', '2027-06-01', '2027-05-10'),
      card('started', '2027-04-01', '2027-05-30'),
    ];
    expect(openSeasonsOf(rows, noon('2027-05-01')).map((row) => row.slug)).toEqual([
      'soon',
      'late',
    ]);
  });

  it('breaks a tie by league name, then season name', () => {
    const rows = [
      card('b', '2027-06-01', '2027-05-10', 'Zulu'),
      card('c', '2027-06-01', '2027-05-10', 'Alpha'),
      card('a', '2027-06-01', '2027-05-10', 'Alpha'),
    ];
    expect(openSeasonsOf(rows, noon('2027-05-01')).map((row) => row.slug)).toEqual(['a', 'c', 'b']);
  });
});

describe('closesText', () => {
  it('writes the month and day of the deadline', () => {
    expect(closesText('2027-05-19')).toBe('May 19');
    expect(closesText('2027-12-01')).toBe('Dec 1');
  });
});

describe('class constants', () => {
  it('match the helm button and the secondary badge the mockup draws', () => {
    expect(REGISTER_BUTTON_LARGE).toBe(buttonVariants({ variant: 'default', size: 'lg' }));
    expect(REGISTER_BUTTON).toBe(buttonVariants({ variant: 'default', size: 'md' }));
    expect(OPEN_BADGE).toContain('bg-secondary text-secondary-foreground');
    expect(OUTLINE_BADGE).toContain('border-border');
  });
});
