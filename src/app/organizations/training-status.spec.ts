import { trainingSeriesStatus, upcomingClasses, upcomingTrainings } from './training-status';

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

const SERIES = { firstDate: '2027-02-02', weeks: 3, registrationDeadline: '2027-02-01' };

describe('trainingSeriesStatus', () => {
  it('is open until the deadline day ends, with the deadline to close on', () => {
    expect(trainingSeriesStatus(SERIES, at('2027-01-20'))).toEqual({
      badge: 'Registration open',
      badgeVariant: 'secondary',
      registrationOpen: true,
      closes: 'Feb 1',
    });
    expect(trainingSeriesStatus(SERIES, at('2027-02-01')).registrationOpen).toBe(true);
  });

  it('is closed after the deadline and before the first class', () => {
    expect(
      trainingSeriesStatus({ ...SERIES, registrationDeadline: '2027-01-25' }, at('2027-01-30')),
    ).toEqual({
      badge: 'Registration closed',
      badgeVariant: 'muted',
      registrationOpen: false,
      closes: null,
    });
  });

  it('is in progress from the first class to the last, and ended after it', () => {
    expect(trainingSeriesStatus(SERIES, at('2027-02-02')).badge).toBe('In progress');
    expect(trainingSeriesStatus(SERIES, at('2027-02-16')).badge).toBe('In progress');
    expect(trainingSeriesStatus(SERIES, at('2027-02-17')).badge).toBe('Ended');
  });
});

describe('upcomingClasses', () => {
  const classes = [{ date: '2027-02-02' }, { date: '2027-02-09' }, { date: '2027-02-16' }];

  it('keeps the class of today and drops the one of yesterday', () => {
    expect(upcomingClasses(classes, at('2027-02-09')).map((row) => row.date)).toEqual([
      '2027-02-09',
      '2027-02-16',
    ]);
  });

  it('keeps none once every class has passed', () => {
    expect(upcomingClasses(classes, at('2027-02-17'))).toEqual([]);
  });
});

describe('upcomingTrainings', () => {
  it('keeps a program whose last class is today and drops one whose last class was yesterday', () => {
    const programs = [
      { slug: 'ended', lastClassDate: '2027-02-08' },
      { slug: 'today', lastClassDate: '2027-02-09' },
    ];
    expect(upcomingTrainings(programs, at('2027-02-09')).map((row) => row.slug)).toEqual(['today']);
  });
});
