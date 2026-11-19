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
      when: 'Jun 8, 2027',
      times: '6 PM to 7 PM',
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

  describe('a series', () => {
    const SERIES: HomeTrainingRow = {
      ...TRAINING,
      upcomingClasses: [
        { date: '2027-06-08', startTime: '18:00', endTime: '19:00' },
        { date: '2027-06-15', startTime: '17:30', endTime: '18:30' },
        { date: '2027-06-22', startTime: '17:30', endTime: '18:30' },
      ],
    };
    const at = (day: number, hour = 15) => Date.UTC(2027, 5, day, hour);
    const next = (now: number) => homeProgramCards([], [SERIES], now)[0];

    it('shows its first upcoming class, with that class’s times', () => {
      expect(next(at(1))).toMatchObject({ when: 'Jun 8, 2027', times: '6 PM to 7 PM' });
    });

    it('keeps a class until its day is over', () => {
      expect(next(at(8, 23))).toMatchObject({ when: 'Jun 8, 2027' });
    });

    it('moves on to the next class once a class has passed, with no new answer', () => {
      expect(next(at(9))).toMatchObject({ when: 'Jun 15, 2027', times: '5:30 PM to 6:30 PM' });
      expect(next(at(16))).toMatchObject({ when: 'Jun 22, 2027' });
    });

    it('drops off after its last class', () => {
      expect(next(at(22, 12))).toBeDefined();
      expect(next(at(23))).toBeUndefined();
    });

    it('reads the row’s own class when an answer lists no classes', () => {
      const { upcomingClasses, ...older } = SERIES;
      void upcomingClasses;
      expect(homeProgramCards([], [older], at(1))).toHaveLength(1);
      expect(homeProgramCards([], [older], at(9))).toHaveLength(0);
    });
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
