import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { expectBadge } from '../ui/testing/badge';
import { routerLinkState } from '../ui/testing/router-link-state';
import { OrganizationPage } from './organization-page';
import type { PublicOrganizationPage, PublicTrainingRows } from './organization-path';
import { GULF_COAST, listPage, queryResults } from './testing/pages';

const TRAINING = 'trainings:listPublic';
const ORG = '/organizations/gulf-coast-sport-social';
const SERVING_PATH = `${ORG}/training/tuesday-serving-clinic`;

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

// 2027-02-02 is a Tuesday.
const SERVING: PublicTrainingRows[number] = {
  name: 'Tuesday Serving Clinic',
  slug: 'tuesday-serving-clinic',
  sportName: 'Beach volleyball',
  coachName: 'Dana Ruiz',
  minimumAge: 16,
  locationNames: ['North Beach Sand Courts'],
  weekday: 2,
  startTime: '18:00',
  endTime: '19:00',
  firstDate: '2027-02-02',
  registrationDeadline: '2027-02-01',
  weeks: 8,
  lastClassDate: '2027-03-23',
};
const PASSING: PublicTrainingRows[number] = {
  ...SERVING,
  name: 'Thursday Passing Clinic',
  slug: 'thursday-passing-clinic',
  sportName: 'Soccer',
  coachName: 'Sam Lee',
  minimumAge: undefined,
  locationNames: [],
  weekday: 4,
  startTime: '09:00',
  endTime: '10:30',
  weeks: 1,
  firstDate: '2027-02-04',
  lastClassDate: '2027-02-04',
};
const ENDED: PublicTrainingRows[number] = {
  ...SERVING,
  name: 'Old Clinic',
  lastClassDate: '2027-01-12',
};

const withTraining = (training: PublicTrainingRows): PublicOrganizationPage => ({
  ...GULF_COAST,
  training,
});

let client: FakeConvexClient;

async function open(url = ORG): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug', component: OrganizationPage },
        { path: 'organizations/:orgSlug/sports/:sport', component: OrganizationPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await settle(harness);
  return harness;
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function emit(
  harness: RouterTestingHarness,
  results: Record<string, unknown>,
): Promise<void> {
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
  await settle(harness);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const section = (harness: RouterTestingHarness) => host(harness).querySelector('#training');
const rows = (harness: RouterTestingHarness) => [
  ...(section(harness)?.querySelectorAll(':scope > ul > li') ?? []),
];
const sectionIds = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('main section')].map((el) => el.id);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-01-20'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the Training section', () => {
  describe('the query', () => {
    it('asks for the organization’s training programs with the page from the URL only', async () => {
      await open(`${ORG}?ott=SECRET&trainingPage=2&campsPage=3#training`);
      expect(
        client.activeSubscriptions
          .filter((s) => s.name === TRAINING)
          .map(({ name, args }) => ({ name, args })),
      ).toEqual([
        { name: TRAINING, args: { organizationSlug: 'gulf-coast-sport-social', page: 2 } },
      ]);
    });

    it('treats a training page that is not a whole number above 0 as page 1', async () => {
      for (const query of ['0', 'abc', '2&trainingPage=3']) {
        TestBed.resetTestingModule();
        await open(`${ORG}?trainingPage=${query}`);
        expect(subscription(TRAINING).args, query).toEqual({
          organizationSlug: 'gulf-coast-sport-social',
          page: 1,
        });
      }
    });

    it('narrows to the sport of the sport view and sends no division filter, which a training program has none of', async () => {
      await open(`${ORG}/sports/beach-volleyball?gender=womens&age=over30&trainingPage=2`);
      expect(subscription(TRAINING).args).toEqual({
        organizationSlug: 'gulf-coast-sport-social',
        sport: 'beachVolleyball',
        page: 2,
      });
    });

    it('is not asked for a segment that names no sport', async () => {
      await open(`${ORG}/sports/curling`);
      expect(client.activeSubscriptions.map((s) => s.name)).not.toContain(TRAINING);
    });
  });

  describe('with upcoming training programs', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      harness = await open();
      await emit(harness, queryResults(withTraining([SERVING, PASSING])));
    });

    it('sits after Leagues and before Locations, under its own heading', () => {
      expect(sectionIds(harness)).toEqual([
        'registration-open',
        'leagues',
        'training',
        'locations',
      ]);
      const heading = section(harness)?.querySelector('h2');
      expect(text(heading)).toBe('Training');
      expect(section(harness)?.getAttribute('aria-labelledby')).toBe(heading?.id);
      expect(heading?.getAttribute('tabindex')).toBe('-1');
    });

    it('lists a row per program in the order the query gives, each with an id to jump to', () => {
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Tuesday Serving Clinic',
        'Thursday Passing Clinic',
      ]);
      expect(rows(harness).map((row) => row.id)).toEqual(['training-1', 'training-2']);
    });

    it('shows the name as a link to its page, the pattern, the coach and ages, the sport and places, and the series status', () => {
      const row = rows(harness)[0];
      const title = row.querySelector('h3 a');
      expect(title?.getAttribute('href')).toBe(SERVING_PATH);
      expect(text(row.querySelector('h3 + p'))).toBe('Tuesdays, 6 to 7 pm, 8 weeks');
      expect(text(row.querySelector('h3 + p + p'))).toBe('Coach Dana Ruiz · 16 or older');
      expect(text(row.querySelector('h3 + p + p + p'))).toBe(
        'Beach volleyball · North Beach Sand Courts',
      );
      expectBadge(row.querySelector('[data-slot="badge"]'), 'secondary', 'fit');
      expect([...(row.querySelector('p:last-of-type')?.children ?? [])].map(text)).toEqual([
        'Registration open',
        'Feb 2 – Mar 23, 2027 · closes Feb 1',
      ]);
    });

    it('leaves out the ages when none are set, and shows a one-week series as "1 week"', () => {
      const row = rows(harness)[1];
      expect(text(row.querySelector('h3 + p'))).toBe('Thursdays, 9 to 10:30 am, 1 week');
      expect(text(row.querySelector('h3 + p + p'))).toBe('Coach Sam Lee');
      expect(text(row.querySelector('h3 + p + p + p'))).toBe('Soccer');
    });

    it('offers no Register link, because registration is its own page', () => {
      expect(text(section(harness))).not.toContain('Register');
    });

    it('gives the title the names of the training program as navigation state', () => {
      const row = rows(harness)[0];
      expect(routerLinkState(harness.fixture, row.querySelector('h3 a'))).toEqual({
        organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
        training: { slug: 'tuesday-serving-clinic', name: 'Tuesday Serving Clinic' },
      });
    });

    it('shows no page control for one page', () => {
      expect(section(harness)?.querySelector('nav')).toBeNull();
    });
  });

  describe('at the viewer’s time', () => {
    it('leaves out a program whose last class has passed since the query ran, and shows none when all have', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTraining([ENDED, SERVING])));
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Tuesday Serving Clinic',
      ]);
      await emit(harness, { ...queryResults(withTraining([])), [TRAINING]: listPage([ENDED], 1) });
      expect(section(harness)).toBeNull();
    });

    it('moves a row to Registration closed and then In progress as the date changes, with no new answer', async () => {
      const harness = await open();
      await emit(
        harness,
        queryResults(
          withTraining([
            { ...SERVING, registrationDeadline: '2027-01-25', firstDate: '2027-02-02' },
          ]),
        ),
      );
      const badge = () => text(rows(harness)[0].querySelector('[data-slot="badge"]'));
      expect(badge()).toBe('Registration open');
      vi.setSystemTime(at('2027-01-26'));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      await settle(harness);
      expect(badge()).toBe('Registration closed');
      vi.setSystemTime(at('2027-02-02'));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      await settle(harness);
      expect(badge()).toBe('In progress');
      expect(client.activeSubscriptions.filter((s) => s.name === TRAINING)).toHaveLength(1);
    });
  });

  describe('with no upcoming training program', () => {
    it('shows no Training section and leaves the sections it had', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTraining([])));
      expect(section(harness)).toBeNull();
      expect(sectionIds(harness)).toEqual(['registration-open', 'leagues', 'locations']);
      expect(text(host(harness))).not.toContain('Training');
    });
  });

  describe('with more than one page', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      ...SERVING,
      name: `Clinic ${i + 1}`,
      slug: `clinic-${i + 1}`,
    }));

    it('shows the control with links that keep the other lists and jump to the section', async () => {
      const harness = await open(`${ORG}?leagues=2&locations=2`);
      await emit(harness, {
        ...queryResults(withTraining([])),
        [TRAINING]: listPage(seven, 1),
        'organizations:listPublicLeagues': listPage(GULF_COAST.leagues, 2, 10),
        'organizations:listPublicLocations': listPage(GULF_COAST.locations, 2, 8),
      });
      const nav = section(harness)?.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Training pages');
      expect(text(nav)).toContain('1–5 of 7');
      const hrefs = [...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain(`${ORG}?leagues=2&locations=2&trainingPage=2#training`);
    });

    it('shows the last 2 on page 2', async () => {
      const harness = await open(`${ORG}?trainingPage=2`);
      await emit(harness, { ...queryResults(withTraining([])), [TRAINING]: listPage(seven, 2) });
      expect(rows(harness).map((row) => row.id)).toEqual(['training-6', 'training-7']);
      expect(text(section(harness)?.querySelector('nav'))).toContain('6–7 of 7');
    });
  });

  describe('the sport view', () => {
    it('lists only that sport’s programs under a sport heading', async () => {
      const harness = await open(`${ORG}/sports/soccer`);
      await emit(harness, {
        ...queryResults(withTraining([])),
        [TRAINING]: listPage([PASSING], 1),
      });
      expect(text(section(harness)?.querySelector('h2'))).toBe('Soccer training');
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Thursday Passing Clinic',
      ]);
    });
  });

  describe('when the query fails', () => {
    it('shows the server-error view, as for each other list', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTraining([SERVING])));
      subscription(TRAINING).fail(new Error('boom'));
      await settle(harness);
      expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
    });
  });
});
