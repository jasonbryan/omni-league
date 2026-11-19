import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { appRouteTitle } from '../shell/testing/app-route-title';
import { BAR_TITLE_PROVIDER } from '../shell/testing/bar-title';
import { expectBadge } from '../ui/testing/badge';
import { AccountPage } from './account-page';
import { HomeShape } from './home-shape';
import type { HomeCampRow, HomeTrainingRow } from './home-program-cards';

@Component({ template: 'home' })
class Home {}

const NOW = Date.UTC(2027, 5, 1, 15);

const TEAM = {
  teamId: 'k1aces',
  teamName: 'Pair of Aces',
  seasonName: 'Summer 2027',
  leagueName: 'Thursday Night Coed 2s',
  organizationName: 'Gulf Coast Sport & Social',
  role: 'player',
  seasonStartDate: '2027-07-03',
  seasonEndDate: '2027-08-26',
  registrationDeadline: '2027-06-30',
  minimumRosterSize: 2,
  rosterCount: 2,
};
const WAITING_FREE_AGENT = {
  freeAgentId: 'k1fa',
  leagueName: 'Coed 7v7 Rec',
  seasonName: 'Summer 2027',
  organizationName: 'Gulf Coast Sport & Social',
  registrationDeadline: '2027-06-19',
  seasonStartDate: '2027-07-06',
  seasonEndDate: '2027-08-29',
};

const WEEK_1: HomeCampRow = {
  rowId: 'k1c1',
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
  locations: ['Alpha Beach'],
};
const WEEK_4_WAITING: HomeCampRow = {
  ...WEEK_1,
  rowId: 'k1c2',
  status: 'waiting',
  position: 1,
  sessionName: 'Week 4',
  startDate: '2027-07-26',
  endDate: '2027-07-30',
};
const SERIES: HomeTrainingRow = {
  rowId: 'k1t1',
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
const SERIES_WAITING: HomeTrainingRow = {
  ...SERIES,
  rowId: 'k1t2',
  status: 'waiting',
  position: 2,
  participant: { kind: 'minor', minorName: 'Maya R.' },
  trainingName: 'Thursday Drop-in Clinic',
  trainingSlug: 'thursday-drop-in-clinic',
};

describe('AccountPage camps and training', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  interface Answers {
    teams?: unknown[];
    freeAgents?: unknown[];
    camps?: HomeCampRow[] | undefined;
    trainings?: HomeTrainingRow[] | undefined;
  }

  async function open() {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        BAR_TITLE_PROVIDER,
        provideRouter([
          { path: 'app', title: appRouteTitle(''), component: AccountPage },
          { path: '', component: Home },
        ]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/app');
    page = harness.routeNativeElement!;
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
  }

  function answer(name: string, value: unknown) {
    for (const subscription of convex.activeSubscriptions) {
      if (subscription.name === name) subscription.emit(value);
    }
  }

  async function show({ teams = [], freeAgents = [], camps, trainings }: Answers) {
    await open();
    answer('users:me', { name: 'Tasha Greene' });
    answer('teams:listMine', teams);
    answer('freeAgents:listMine', freeAgents);
    answer('organizations:listMine', []);
    if (camps !== undefined) answer('campRegistrations:listMine', camps);
    if (trainings !== undefined) answer('trainingRegistrations:listMine', trainings);
    await harness.fixture.whenStable();
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const main = () => page.querySelector('main')!;
  const section = () => main().querySelector('section[aria-labelledby="programs-heading"]');
  const cards = () => [...(section()?.querySelectorAll('li') ?? [])];
  const facts = (card: Element): Record<string, string | undefined> =>
    Object.fromEntries(
      [...card.querySelectorAll('dt')].map((dt) => [text(dt) ?? '', text(dt.nextElementSibling)]),
    );
  const newUserHeading = () =>
    [...main().querySelectorAll('h2')].find((h) => text(h) === "You're not on a team yet");

  afterEach(() => vi.useRealTimers());

  it('asks campRegistrations.listMine and trainingRegistrations.listMine only once Convex has accepted the token', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        BAR_TITLE_PROVIDER,
        provideRouter([{ path: 'app', title: appRouteTitle(''), component: AccountPage }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    await RouterTestingHarness.create('/app');
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    const asked = convex.activeSubscriptions.map((s) => s.name);
    expect(asked).toContain('campRegistrations:listMine');
    expect(asked).toContain('trainingRegistrations:listMine');
  });

  it('shows no section when there is no camp or training registration', async () => {
    await show({ teams: [TEAM], camps: [], trainings: [] });
    expect(section()).toBeNull();
    expect(main().textContent).not.toContain('Camps and training');
  });

  it('is an h2 over a card for each registration, soonest first, each program name an h3 link', async () => {
    await show({
      teams: [TEAM],
      camps: [WEEK_4_WAITING, WEEK_1],
      trainings: [SERIES, SERIES_WAITING],
    });
    expect(text(section()?.querySelector('h2'))).toBe('Camps and training');
    expect(cards().map((card) => text(card.querySelector('h3')))).toEqual([
      'Tuesday Serving Clinic',
      'Thursday Drop-in Clinic',
      'Junior Beach Volleyball Camp',
      'Junior Beach Volleyball Camp',
    ]);
    expect(cards().map((card) => card.querySelector('h3 a')?.getAttribute('href'))).toEqual([
      '/organizations/gulf-coast/training/tuesday-serving-clinic',
      '/organizations/gulf-coast/training/thursday-drop-in-clinic',
      '/organizations/gulf-coast/camps/junior-beach-volleyball-camp',
      '/organizations/gulf-coast/camps/junior-beach-volleyball-camp',
    ]);
  });

  it('gives a camp card its session, dates, times, place, and who attends', async () => {
    await show({ camps: [WEEK_1], trainings: [] });
    const [card] = cards();
    expect(text(card?.querySelector('p'))).toBe('Gulf Coast Sport & Social · Week 1');
    expect(facts(card)).toEqual({
      Dates: 'Jul 5 – Jul 9 9 AM to 12:30 PM',
      Where: 'Alpha Beach',
      Attending: 'Maya R.',
    });
  });

  it('gives a series card its next class, and names the account holder "You"', async () => {
    await show({ camps: [], trainings: [SERIES] });
    const [card] = cards();
    expect(text(card?.querySelector('p'))).toBe('Gulf Coast Sport & Social · Series');
    expect(facts(card)).toEqual({
      'Next class': 'Tue, Jun 8, 2027 6 to 7 pm',
      Where: 'Alpha Beach',
      Attending: 'You',
    });
  });

  it('marks a waiting entry "Waitlist, position N" in a muted badge', async () => {
    await show({ camps: [WEEK_1, WEEK_4_WAITING], trainings: [SERIES_WAITING] });
    const badges = cards().map((card) => card.querySelector('[data-slot="badge"]'));
    expect(badges.map((badge) => text(badge) ?? null)).toEqual([
      'Waitlist, position 2',
      null,
      'Waitlist, position 1',
    ]);
    expectBadge(badges[0], 'muted', 'default');
  });

  it('leaves a camp session that has ended off the home', async () => {
    await show({
      camps: [{ ...WEEK_1, startDate: '2027-05-24', endDate: '2027-05-28' }],
      trainings: [],
    });
    expect(section()).toBeNull();
  });

  it('follows the section Your teams and a free agent, and leads into Notifications', async () => {
    await show({
      teams: [TEAM],
      freeAgents: [WAITING_FREE_AGENT],
      camps: [WEEK_1],
      trainings: [],
    });
    const order = [
      'teams-heading',
      'free-agent-heading',
      'programs-heading',
      'app-notifications-heading',
    ].map((id) => main().querySelector(`section[aria-labelledby="${id}"]`));
    for (const found of order) expect(found).not.toBeNull();
    for (let index = 1; index < order.length; index++) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  describe('a user whose only items are camps or training', () => {
    it.each([
      ['a camp', { camps: [WEEK_1], trainings: [] }],
      ['a training series', { camps: [], trainings: [SERIES] }],
      ['a waitlist entry', { camps: [WEEK_4_WAITING], trainings: [] }],
    ])('with %s sees the section and not the new-user state', async (_name, answers) => {
      await show(answers);
      expect(cards()).toHaveLength(1);
      expect(newUserHeading()).toBeUndefined();
      expect(main().textContent).not.toContain('Find a league, then register');
      expect(text(page.querySelector('main > div > p'))).toBe('Your teams and registrations.');
      expect(main().querySelector('section[aria-labelledby="teams-heading"]')).toBeNull();
      expect(
        main().querySelector('section[aria-labelledby="app-notifications-heading"]'),
      ).not.toBeNull();
    });

    it('shows the new-user state when every row has passed', async () => {
      await show({
        camps: [{ ...WEEK_1, startDate: '2027-05-24', endDate: '2027-05-28' }],
        trainings: [],
      });
      expect(newUserHeading()).toBeDefined();
    });

    it('follows the live query: a registration made while the home is open takes the new-user state away', async () => {
      await show({ camps: [], trainings: [] });
      expect(newUserHeading()).toBeDefined();
      answer('campRegistrations:listMine', [WEEK_1]);
      await harness.fixture.whenStable();
      expect(newUserHeading()).toBeUndefined();
      expect(cards()).toHaveLength(1);
    });

    it('is the list shape for the next visit', async () => {
      await show({ camps: [WEEK_1], trainings: [] });
      await harness.navigateByUrl('/');
      expect(TestBed.inject(HomeShape).current()).toBe('list');
    });
  });

  describe('loading', () => {
    const skeleton = () => main().querySelector('app-home-skeleton');

    it.each([
      ['camp', { trainings: [] as HomeTrainingRow[] }],
      ['training', { camps: [] as HomeCampRow[] }],
    ])(
      'keeps the skeleton while the %s rows are still loading, so the section never arrives late',
      async (_name, answers) => {
        await show({ teams: [TEAM], ...answers });
        expect(skeleton()).not.toBeNull();
        expect(text(main().querySelector('[role="status"]'))).toBe(
          'Loading your teams and registrations.',
        );
        expect(main().querySelector('section[aria-labelledby="teams-heading"]')).toBeNull();
        expect(section()).toBeNull();
      },
    );
  });

  describe('error', () => {
    it.each([['campRegistrations:listMine'], ['trainingRegistrations:listMine']])(
      'shows the failure alert with Try again when %s fails, and no card',
      async (name) => {
        await open();
        answer('teams:listMine', [TEAM]);
        answer('freeAgents:listMine', []);
        answer('organizations:listMine', []);
        for (const subscription of convex.activeSubscriptions) {
          if (subscription.name === name) subscription.fail(new Error('Server Error'));
        }
        await harness.fixture.whenStable();
        const alert = main().querySelector('[role="alert"]');
        expect(text(alert)).toContain('Your teams and registrations could not be loaded.');
        expect(text(alert?.querySelector('a'))).toBe('Try again');
        expect(section()).toBeNull();
        expect(main().querySelector('section[aria-labelledby="teams-heading"]')).toBeNull();
      },
    );
  });

  describe('long names', () => {
    it('wraps a long program, organization, place, and child name inside the card', async () => {
      await show({
        camps: [
          {
            ...WEEK_1,
            campName: 'C'.repeat(60),
            organizationName: 'O'.repeat(60),
            sessionName: 'S'.repeat(60),
            locations: ['L'.repeat(60)],
            participant: { kind: 'minor', minorName: 'M'.repeat(60) },
          },
        ],
        trainings: [],
      });
      const [card] = cards();
      expect(card?.querySelector('h3 a')?.className).toContain('wrap-anywhere');
      expect(card?.querySelector('p')?.className).toContain('wrap-anywhere');
      for (const dd of card.querySelectorAll('dd')) expect(dd.className).toContain('wrap-anywhere');
    });
  });
});
