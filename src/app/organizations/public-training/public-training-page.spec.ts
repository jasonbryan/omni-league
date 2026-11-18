import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { PAGE_LOAD_WAIT_MS } from '../../public-layout/page-load-wait-ms';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { expectBareCard } from '../../ui/testing/card';
import { slotsOf } from '../../ui/testing/helm-slots';
import { PublicTrainingPage } from './public-training-page';
import {
  at,
  ORG_SLUG,
  TRAINING_ARGS,
  TRAINING_PATH,
  TUESDAY_CLINIC,
} from './testing/training-data';

const TRAINING = 'trainings:getPublicPage';

let client: FakeConvexClient;

async function open(url = TRAINING_PATH, state?: Record<string, unknown>) {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'organizations/:orgSlug/training/:trainingSlug',
          component: PublicTrainingPage,
        },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(state === undefined ? url : undefined);
  if (state !== undefined) await TestBed.inject(Router).navigateByUrl(url, { state });
  TestBed.tick();
  return harness;
}

function subscription(): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === TRAINING);
  expect(active).toHaveLength(1);
  return active[0];
}

function emit(result: unknown = TUESDAY_CLINIC): void {
  subscription().emit(result);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// The template drops the whitespace between elements, so `textContent` runs a label into its value.
const spaced = (el: Element | null | undefined) =>
  (el?.innerHTML ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const head = () => TestBed.inject(DOCUMENT).head;
const metaContent = (property: string) =>
  head().querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const classRows = (harness: RouterTestingHarness) => [
  ...host(harness).querySelectorAll('main #classes li'),
];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-01-20'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('PublicTrainingPage queries', () => {
  it('asks for the training program with the route’s slugs only', async () => {
    await open(`${TRAINING_PATH}?ott=SECRET&utm_source=x#classes`);
    expect(client.activeSubscriptions.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: TRAINING, args: TRAINING_ARGS },
    ]);
  });
});

describe('PublicTrainingPage loading', () => {
  it('shows the skeleton with its status and no heading until the result has arrived', async () => {
    const harness = await open();
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    const skeleton = host(harness).querySelector('[data-testid="training-skeleton"]');
    expect(text(skeleton?.querySelector('[role="status"]'))).toBe('Loading the training program.');
    expect(skeleton?.querySelector('[role="status"]')?.classList).toContain('sr-only');
    emit();
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Tuesday Serving Clinic');
    expect(host(harness).querySelector('[data-testid="training-skeleton"]')).toBeNull();
  });

  it('falls back to the error view when the training program never answers', async () => {
    const harness = await open();
    vi.advanceTimersByTime(PAGE_LOAD_WAIT_MS);
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
  });
});

describe('PublicTrainingPage skeleton names', () => {
  const NAMES = {
    organization: { slug: ORG_SLUG, name: 'Gulf Coast Sport & Social' },
    training: { slug: 'tuesday-serving-clinic', name: 'Tuesday Serving Clinic' },
  };
  const SKELETON = '[data-testid="training-skeleton"]';

  async function loading(state?: Record<string, unknown>): Promise<HTMLElement> {
    const harness = await open(TRAINING_PATH, state);
    await settle(harness);
    return host(harness).querySelector<HTMLElement>(SKELETON)!;
  }

  it('shows the names the navigation carried, in place of the bars, while the data is on its way', async () => {
    const skeleton = await loading(NAMES);
    expect(
      [...skeleton.querySelectorAll('[data-testid="skeleton-breadcrumb"] li > span')].map(text),
    ).toEqual(['Gulf Coast Sport & Social', 'Training']);
    expect(text(skeleton.querySelector('[data-testid="skeleton-heading"]'))).toBe(
      'Tuesday Serving Clinic',
    );
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).toBeNull();
  });

  it.each([
    ['another program’s slug', { ...NAMES, training: { ...NAMES.training, slug: 'other' } }],
    ['a field that is not text', { ...NAMES, training: { ...NAMES.training, name: 4 } }],
  ])('shows the bars for %s', async (_, state) => {
    const skeleton = await loading(state);
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb"]')).toBeNull();
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).not.toBeNull();
  });
});

describe('PublicTrainingPage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb organization then Training, and the program as the only h1', () => {
    const main = host(harness).querySelector('main');
    const links = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] a') ?? [])];
    expect(links.map(text)).toEqual(['Gulf Coast Sport & Social', 'Training']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/organizations/${ORG_SLUG}`,
      `/organizations/${ORG_SLUG}#training`,
    ]);
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Tuesday Serving Clinic');
  });

  it('renders helm breadcrumb, with no current-page item because the h1 names the program', () => {
    expect(slotsOf(host(harness).querySelector('main nav[aria-label="Breadcrumb"]'))).toEqual([
      'breadcrumb',
      'breadcrumb-list',
      'breadcrumb-item',
      'breadcrumb-link',
      'breadcrumb-separator',
      'breadcrumb-item',
      'breadcrumb-link',
    ]);
  });

  it('writes the pattern and then the sport and place under the h1', () => {
    const h1 = host(harness).querySelector('main h1');
    expect(text(h1?.nextElementSibling)).toBe('Tuesdays, 6 to 7 pm, 3 weeks');
    expect(text(h1?.nextElementSibling?.nextElementSibling)).toBe(
      'Beach volleyball · North Beach Sand Courts',
    );
  });

  it('puts the classes after the h1 and before the details, in a bare helm card', () => {
    const main = host(harness).querySelector('main')!;
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    const classes = main.querySelector('#classes')!;
    const details = main.querySelector('section[aria-labelledby="details-heading"]')!;
    expect(main.querySelector('h1')!.compareDocumentPosition(classes) & follows).toBeTruthy();
    expect(classes.compareDocumentPosition(details) & follows).toBeTruthy();
    const cards = host(harness).querySelectorAll('#classes [data-slot="card"]');
    expect(cards).toHaveLength(1);
    expectBareCard(cards[0], 'overflow-hidden');
  });

  it('lists each upcoming class with its day, hours, and places left, and Full for none left', () => {
    expect(classRows(harness).map((row) => spaced(row))).toEqual([
      'Tue, Feb 2, 2027 6 to 7 pm 12 places left',
      'Tue, Feb 9, 2027 6 to 7 pm 1 place left',
      'Tue, Feb 16, 2027 Full 6 to 7 pm Full',
    ]);
  });

  it('writes the coach, the ages, the location with its address, the schedule, and the registration status', () => {
    expect([...host(harness).querySelectorAll('main dl > div')].map((row) => spaced(row))).toEqual([
      'Coach Dana Ruiz',
      'Ages 16 or older',
      'Location North Beach Sand Courts 3500 Sandcourt Ln, Corpus Christi, TX 78402',
      'Schedule Tuesdays, 6 to 7 pm, 3 weeks First class Feb 2, 2027',
      'Registration Registration open Closes Feb 1, 2027 A class is full, so no place is left for the whole series. Join the waitlist for the series',
    ]);
  });

  it('leaves out the ages when neither bound is set', async () => {
    TestBed.resetTestingModule();
    const noAges = await open();
    emit({ ...TUESDAY_CLINIC, minimumAge: undefined });
    await settle(noAges);
    expect(spaced(host(noAges).querySelector('main dl'))).not.toContain('Ages');
  });

  it('offers no Register control while a class is full, and the waitlist in its place', () => {
    const main = host(harness).querySelector('main')!;
    expect(text(main)).not.toMatch(/Register/);
    const links = [...main.querySelectorAll('a[href*="register"]')];
    expect(links.map((link) => text(link))).toEqual(['Join the waitlist for the series']);
  });

  it('writes no price, which the page does not hold', () => {
    expect(text(host(harness).querySelector('main'))).not.toMatch(/\$|price|fee/i);
  });

  it('sets the title, the og tags, and one canonical from the program', () => {
    const title = 'Tuesday Serving Clinic | Gulf Coast Sport & Social | Omni League';
    expect(TestBed.inject(Title).getTitle()).toBe(title);
    expect(metaContent('og:title')).toBe(title);
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Beach volleyball · 16 or older. Coach Dana Ruiz. Tuesdays, 6 to 7 pm, 3 weeks.',
    );
    expect(canonical()).toContain(TRAINING_PATH);
  });
});

describe('PublicTrainingPage clock', () => {
  async function opened(now: number) {
    vi.setSystemTime(now);
    const harness = await open();
    emit();
    await settle(harness);
    return harness;
  }

  it('lists no class that has passed by the viewer’s clock, though the answer still holds it', async () => {
    const harness = await opened(at('2027-02-10'));
    expect(classRows(harness).map((row) => spaced(row))).toEqual([
      'Tue, Feb 16, 2027 Full 6 to 7 pm Full',
    ]);
  });

  it('keeps the class of today on the page all day', async () => {
    const harness = await opened(at('2027-02-09'));
    expect(classRows(harness)).toHaveLength(2);
  });

  it('reads "This training has ended." with no class and no registration once every class has passed', async () => {
    const harness = await opened(at('2027-02-17'));
    const main = host(harness).querySelector('main')!;
    expect(classRows(harness)).toEqual([]);
    expect(text(main.querySelector('[data-slot="training-ended"]'))).toBe(
      'This training has ended.',
    );
    expect(text(main)).not.toMatch(/Register|Registration/);
    expect(main.querySelector('[data-slot="series-status"]')).toBeNull();
    expect(text(main.querySelector('h1'))).toBe('Tuesday Serving Clinic');
  });

  it('reads the same ended text when the answer holds no class', async () => {
    vi.setSystemTime(at('2027-01-20'));
    const harness = await open();
    emit({ ...TUESDAY_CLINIC, classes: [] });
    await settle(harness);
    expect(text(host(harness).querySelector('main [data-slot="training-ended"]'))).toBe(
      'This training has ended.',
    );
  });

  it('moves the registration status with the clock: open, closed after the deadline, in progress once the classes begin', async () => {
    const earlyDeadline = {
      ...TUESDAY_CLINIC,
      pattern: { ...TUESDAY_CLINIC.pattern, registrationDeadline: '2027-01-25' },
    };
    const registration = async (now: number) => {
      TestBed.resetTestingModule();
      vi.setSystemTime(now);
      const harness = await open();
      emit(earlyDeadline);
      await settle(harness);
      const fact = host(harness).querySelector('[data-slot="series-status"]')!.closest('div')!;
      return spaced(fact);
    };
    expect(await registration(at('2027-01-25'))).toBe(
      'Registration Registration open Closes Jan 25, 2027 A class is full, so no place is left for the whole series. Join the waitlist for the series',
    );
    expect(await registration(at('2027-01-30'))).toBe('Registration Registration closed');
    expect(await registration(at('2027-02-02'))).toBe('Registration In progress');
  });

  it('writes "Closes" only while registration is open, never a deadline that has passed', async () => {
    for (const now of [at('2027-01-30'), at('2027-02-03')]) {
      TestBed.resetTestingModule();
      vi.setSystemTime(now);
      const harness = await open();
      emit({
        ...TUESDAY_CLINIC,
        pattern: { ...TUESDAY_CLINIC.pattern, registrationDeadline: '2027-01-25' },
      });
      await settle(harness);
      expect(text(host(harness).querySelector('main dl'))).not.toContain('Closes');
    }
  });

  it('says every class is cancelled, in place of the ended line, with no class and no registration', async () => {
    vi.setSystemTime(at('2027-01-20'));
    const harness = await open();
    emit({ ...TUESDAY_CLINIC, classes: [], everyClassCancelled: true });
    await settle(harness);
    const main = host(harness).querySelector('main')!;
    expect(text(main.querySelector('[data-slot="training-cancelled"]'))).toBe(
      'Every class of this training program is cancelled.',
    );
    expect(main.querySelector('[data-slot="training-ended"]')).toBeNull();
    expect(classRows(harness)).toEqual([]);
    expect(main.querySelector('[data-slot="series-status"]')).toBeNull();
    expect(text(main)).not.toMatch(/Register|ended/);
  });
});

describe('PublicTrainingPage states', () => {
  it('shows the not-found view for a null answer, a draft or an unknown program', async () => {
    const harness = await open();
    emit(null);
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(host(harness).querySelector('main h1')?.textContent).toContain('Page not found');
  });

  it('shows the server-error view with a retry link to the page when the query fails', async () => {
    const harness = await open();
    subscription().fail(new Error('boom'));
    await settle(harness);
    const view = host(harness).querySelector('app-server-error-view');
    expect(view).not.toBeNull();
    expect(view?.querySelector('a')?.getAttribute('href')).toBe(TRAINING_PATH);
  });
});
