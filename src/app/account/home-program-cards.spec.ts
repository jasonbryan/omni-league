import { homeProgramCards, type HomeCampRow, type HomeTrainingRow } from './home-program-cards';

const NOW = Date.UTC(2027, 5, 1, 15);

const CAMP: HomeCampRow = {
  rowId: 'c1',
  status: 'registered',
  participant: { kind: 'minor', minorName: 'Maya R.' },
  organizationName: 'Gulf Coast Sport & Social',
  organizationSlug: 'gulf-coast',
  campName: 'Junior Beach Volleyball Camp',
  campSlug: 'junior-beach-volleyball-camp',
  sessionName: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:30',
  locations: ['Alpha Beach', 'Bravo Field'],
};

const TRAINING: HomeTrainingRow = {
  rowId: 't1',
  kind: 'series',
  status: 'registered',
  participant: { kind: 'self' },
  organizationName: 'Gulf Coast Sport & Social',
  organizationSlug: 'gulf-coast',
  trainingName: 'Tuesday Serving Clinic',
  trainingSlug: 'tuesday-serving-clinic',
  classDate: '2027-06-08',
  startTime: '18:00',
  endTime: '19:00',
  locations: ['Alpha Beach'],
};

describe('homeProgramCards', () => {
  it('writes a camp session card from its stored text', () => {
    const [card] = homeProgramCards([CAMP], [], NOW);
    expect(card).toMatchObject({
      key: 'camp:c1',
      title: 'Junior Beach Volleyball Camp',
      path: '/organizations/gulf-coast/camps/junior-beach-volleyball-camp',
      detail: 'Gulf Coast Sport & Social · Week 1',
      whenLabel: 'Dates',
      when: 'Jul 5 – Jul 9',
      times: '9 AM to 12:30 PM',
      where: 'Alpha Beach, Bravo Field',
      who: 'Maya R.',
      waitlist: null,
    });
  });

  it('names the account holder "You"', () => {
    const [card] = homeProgramCards([{ ...CAMP, participant: { kind: 'self' } }], [], NOW);
    expect(card?.who).toBe('You');
  });

  it('leaves out the times and the place a camp session has none of', () => {
    const { dailyStartTime, dailyEndTime, ...untimed } = CAMP;
    void dailyStartTime;
    void dailyEndTime;
    const [card] = homeProgramCards([{ ...untimed, locations: [] }], [], NOW);
    expect(card?.times).toBeNull();
    expect(card?.where).toBeNull();
  });

  it('writes a series card with its next class', () => {
    const [card] = homeProgramCards([], [TRAINING], NOW);
    expect(card).toMatchObject({
      key: 'training:t1',
      title: 'Tuesday Serving Clinic',
      path: '/organizations/gulf-coast/training/tuesday-serving-clinic',
      detail: 'Gulf Coast Sport & Social · Series',
      whenLabel: 'Next class',
      when: 'Tue, Jun 8, 2027',
      times: '6 to 7 pm',
      where: 'Alpha Beach',
      who: 'You',
      waitlist: null,
    });
  });

  it('writes a single-class card as one class', () => {
    const [card] = homeProgramCards([], [{ ...TRAINING, kind: 'class' }], NOW);
    expect(card).toMatchObject({
      detail: 'Gulf Coast Sport & Social · Single class',
      whenLabel: 'Class',
    });
  });

  it('says where a waiting entry stands in the queue', () => {
    const cards = homeProgramCards(
      [{ ...CAMP, status: 'waiting', position: 2 }],
      [{ ...TRAINING, status: 'waiting', position: 1 }],
      NOW,
    );
    expect(cards.map((card) => card.waitlist)).toEqual([
      'Waitlist, position 1',
      'Waitlist, position 2',
    ]);
  });

  it('lists the soonest first across camps and training, camps ahead of training on one day', () => {
    const cards = homeProgramCards(
      [
        { ...CAMP, rowId: 'late', startDate: '2027-08-02', endDate: '2027-08-06' },
        { ...CAMP, rowId: 'same', startDate: '2027-06-08', endDate: '2027-06-12' },
      ],
      [TRAINING, { ...TRAINING, rowId: 't2', classDate: '2027-06-02' }],
      NOW,
    );
    expect(cards.map((card) => card.key)).toEqual([
      'training:t2',
      'camp:same',
      'training:t1',
      'camp:late',
    ]);
  });

  it('hides a camp session that has ended and a single class that has passed, and keeps one that ends today', () => {
    const cards = homeProgramCards(
      [
        { ...CAMP, rowId: 'over', startDate: '2027-05-24', endDate: '2027-05-31' },
        { ...CAMP, rowId: 'today', startDate: '2027-05-28', endDate: '2027-06-01' },
      ],
      [{ ...TRAINING, kind: 'class', classDate: '2027-05-25' }],
      NOW,
    );
    expect(cards.map((card) => card.key)).toEqual(['camp:today']);
  });

  it('keeps a series whose next class the server has not moved on yet', () => {
    const cards = homeProgramCards([], [{ ...TRAINING, classDate: '2027-05-25' }], NOW);
    expect(cards.map((card) => card.key)).toEqual(['training:t1']);
  });

  it('keeps a camp session that has begun ahead of one still to come', () => {
    const cards = homeProgramCards(
      [CAMP, { ...CAMP, rowId: 'now', startDate: '2027-05-31', endDate: '2027-06-04' }],
      [],
      NOW,
    );
    expect(cards.map((card) => card.key)).toEqual(['camp:now', 'camp:c1']);
  });

  it('builds the path from the slugs, so a slug cannot change it', () => {
    const [card] = homeProgramCards(
      [{ ...CAMP, organizationSlug: 'a/b', campSlug: '../x?y' }],
      [],
      NOW,
    );
    expect(card?.path).toBe('/organizations/a%2Fb/camps/..%2Fx%3Fy');
  });
});
