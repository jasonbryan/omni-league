import { campStatus, openCampSessionsBySoonestDeadline, upcomingCamps } from './camp-status';

const NEXT = {
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  registrationDeadline: '2027-07-01',
  placesLeft: 12,
};
// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

describe('upcomingCamps', () => {
  const camp = (slug: string, lastSessionEndDate: string) => ({ slug, lastSessionEndDate });

  it('keeps a camp whose last session ends today and drops one that ended yesterday', () => {
    expect(
      upcomingCamps(
        [camp('ended', '2027-07-08'), camp('today', '2027-07-09'), camp('later', '2027-08-01')],
        at('2027-07-09'),
      ).map((row) => row.slug),
    ).toEqual(['today', 'later']);
  });
});

describe('campStatus', () => {
  it('is Registration open with the closing day and a Register link while the next session has room', () => {
    expect(campStatus(NEXT, at('2027-06-20'))).toEqual({
      badge: 'Registration open',
      badgeVariant: 'secondary',
      registrationOpen: true,
      text: 'Jul 5 – Jul 9, 2027 · closes Jul 1',
    });
  });

  it('is Full with no Register link while registration is open and no place is left', () => {
    expect(campStatus({ ...NEXT, placesLeft: 0 }, at('2027-06-20'))).toEqual({
      badge: 'Full',
      badgeVariant: 'outline',
      registrationOpen: false,
      text: 'Jul 5 – Jul 9, 2027',
    });
  });

  it('is Registration closed after the deadline, not Full', () => {
    expect(campStatus({ ...NEXT, placesLeft: 0 }, at('2027-07-02'))).toMatchObject({
      badge: 'Registration closed',
      badgeVariant: 'muted',
      registrationOpen: false,
    });
  });

  it('is In progress on the days of the session', () => {
    expect(campStatus(NEXT, at('2027-07-07'))).toMatchObject({
      badge: 'In progress',
      registrationOpen: false,
    });
  });
});

describe('openCampSessionsBySoonestDeadline', () => {
  const session = (sessionName: string, registrationDeadline: string, name = 'Camp') => ({
    name,
    sessionName,
    startDate: '2027-08-02',
    endDate: '2027-08-06',
    registrationDeadline,
    placesLeft: 5,
  });

  it('drops a session whose registration has closed or whose first day has come, and orders by deadline, then camp name, then session name', () => {
    const rows = [
      session('Closed', '2027-07-01'),
      session('Late', '2027-07-20'),
      session('Zed week', '2027-07-10', 'Zed Camp'),
      session('Week 2', '2027-07-10'),
      session('Week 1', '2027-07-10'),
    ];
    expect(
      openCampSessionsBySoonestDeadline(rows as never, at('2027-07-05')).map(
        (row) => `${row.name}/${row.sessionName}`,
      ),
    ).toEqual(['Camp/Week 1', 'Camp/Week 2', 'Zed Camp/Zed week', 'Camp/Late']);
  });
});
