import {
  OPEN_BADGE,
  MUTED_BADGE,
  closesText,
  leagueSeasonStatus,
  nextSeason,
  openSeasonsBySoonestDeadline,
  soonestClosingOpenSeason,
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
      season: { name: 'NEXT', slug: 'next' },
    });
  });

  it('names a season whose registration closed', () => {
    expect(leagueSeasonStatus([NEXT], noon('2027-05-25'))).toEqual({
      badge: 'Registration closed',
      open: false,
      text: 'NEXT',
      season: { name: 'NEXT', slug: 'next' },
    });
  });

  it('names a season in progress', () => {
    expect(leagueSeasonStatus([CURRENT, ENDED], noon('2026-10-27'))).toEqual({
      badge: 'In progress',
      open: false,
      text: 'CURRENT',
      season: { name: 'CURRENT', slug: 'current' },
    });
  });

  it('says there is no upcoming season when only ended seasons remain, and when there are none', () => {
    const none = { badge: null, open: false, text: 'No upcoming season', season: null };
    expect(leagueSeasonStatus([ENDED], noon('2026-10-27'))).toEqual(none);
    expect(leagueSeasonStatus([], noon('2026-10-27'))).toEqual(none);
  });

  it('leads with the season open for registration over one in progress', () => {
    expect(leagueSeasonStatus([CURRENT, LATER], noon('2027-08-01'))).toEqual({
      badge: 'Registration open',
      open: true,
      text: 'LATER · closes Aug 29',
      season: { name: 'LATER', slug: 'later' },
    });
  });

  it('leads with the open season even when a not-open season starts earlier', () => {
    const closed = season('closed', '2027-06-01', '2027-08-30', '2027-05-19');
    const open = season('open', '2027-06-10', '2027-08-30', '2027-06-05');
    expect(leagueSeasonStatus([closed, open], noon('2027-05-25'))?.season?.slug).toBe('open');
  });

  it('shows the next season when none is open', () => {
    const underway = season('underway', '2027-03-01', '2027-07-01', '2027-02-01');
    expect(leagueSeasonStatus([NEXT, underway], noon('2027-05-25'))).toMatchObject({
      badge: 'In progress',
      season: { slug: 'underway' },
    });
  });

  it('says nothing for a saved copy made before rows held their seasons', () => {
    expect(leagueSeasonStatus(undefined, noon('2026-10-27'))).toBeUndefined();
  });

  it('moves a season from open to closed as the clock passes its deadline', () => {
    expect(leagueSeasonStatus([NEXT], noon('2027-05-19'))?.badge).toBe('Registration open');
    expect(leagueSeasonStatus([NEXT], noon('2027-05-20'))?.badge).toBe('Registration closed');
  });
});

describe('soonestClosingOpenSeason', () => {
  const at = (...rest: [string, string, string, string]) => season(...rest);
  const now = noon('2027-04-01');

  it('is the open season, whatever the status of the others', () => {
    const inProgress = at('current', '2027-03-01', '2027-05-30', '2027-02-15');
    const open = at('summer', '2027-06-06', '2027-08-29', '2027-05-23');
    expect(soonestClosingOpenSeason([inProgress, open], now)?.slug).toBe('summer');
  });

  it('is the one with the soonest deadline when several are open', () => {
    const later = at('fall', '2027-09-12', '2027-11-14', '2027-08-29');
    const sooner = at('summer', '2027-06-06', '2027-08-29', '2027-05-23');
    expect(soonestClosingOpenSeason([later, sooner], now)?.slug).toBe('summer');
  });

  it('breaks a tie of deadlines by the earlier start date, then the lower slug', () => {
    const later = at('a', '2027-07-01', '2027-08-29', '2027-05-23');
    const earlier = at('c', '2027-06-06', '2027-08-29', '2027-05-23');
    const sameStart = at('b', '2027-06-06', '2027-08-29', '2027-05-23');
    expect(soonestClosingOpenSeason([later, earlier], now)?.slug).toBe('c');
    expect(soonestClosingOpenSeason([earlier, sameStart, later], now)?.slug).toBe('b');
  });

  it('keeps registration open through the deadline date and closes it the day after', () => {
    const summer = at('summer', '2027-06-06', '2027-08-29', '2027-05-23');
    expect(soonestClosingOpenSeason([summer], noon('2027-05-23'))).toBeDefined();
    expect(soonestClosingOpenSeason([summer], noon('2027-05-24'))).toBeUndefined();
  });

  it('is none for a season that has started, whatever its deadline', () => {
    const started = at('started', '2027-06-06', '2027-08-29', '2027-07-01');
    expect(soonestClosingOpenSeason([started], noon('2027-06-06'))).toBeUndefined();
  });

  it('is none without seasons, and for a copy saved before the page held them', () => {
    expect(soonestClosingOpenSeason([], now)).toBeUndefined();
    expect(soonestClosingOpenSeason(undefined, now)).toBeUndefined();
  });
});

describe('openSeasonsBySoonestDeadline', () => {
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
    expect(openSeasonsBySoonestDeadline(rows, noon('2027-05-01')).map((row) => row.slug)).toEqual([
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
    expect(openSeasonsBySoonestDeadline(rows, noon('2027-05-01')).map((row) => row.slug)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });
});

describe('closesText', () => {
  it('writes the month and day of the deadline', () => {
    expect(closesText('2027-05-19')).toBe('May 19');
    expect(closesText('2027-12-01')).toBe('Dec 1');
  });
});

describe('badge classes', () => {
  it('are the secondary badge for Registration open and the muted badge for the other phases', () => {
    expect(OPEN_BADGE).toContain('bg-secondary text-secondary-foreground');
    expect(MUTED_BADGE).toContain('bg-muted text-muted-foreground');
  });
});
