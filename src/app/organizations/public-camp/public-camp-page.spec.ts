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
import { PublicCampPage } from './public-camp-page';
import { at, CAMP_ARGS, CAMP_PATH, JUNIOR_CAMP, ORG_SLUG } from './testing/camp-data';

const CAMP = 'camps:getPublicPage';
const HOUR = 60 * 60 * 1000;

let client: FakeConvexClient;

async function open(url = CAMP_PATH, state?: Record<string, unknown>) {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug/camps/:campSlug', component: PublicCampPage },
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
  const active = client.activeSubscriptions.filter((s) => s.name === CAMP);
  expect(active).toHaveLength(1);
  return active[0];
}

function emit(result: unknown = JUNIOR_CAMP): void {
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
const sessionRows = (harness: RouterTestingHarness) => [
  ...host(harness).querySelectorAll('main #sessions li'),
];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-06-01'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('PublicCampPage queries', () => {
  it('asks for the camp with the route’s slugs only', async () => {
    await open(`${CAMP_PATH}?ott=SECRET&utm_source=x#sessions`);
    expect(client.activeSubscriptions.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: CAMP, args: CAMP_ARGS },
    ]);
  });
});

describe('PublicCampPage loading', () => {
  it('shows the skeleton with its status and no heading until the result has arrived', async () => {
    const harness = await open();
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    const skeleton = host(harness).querySelector('[data-testid="camp-skeleton"]');
    expect(text(skeleton?.querySelector('[role="status"]'))).toBe('Loading the camp.');
    expect(skeleton?.querySelector('[role="status"]')?.classList).toContain('sr-only');
    emit();
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Junior Beach Volleyball Camp');
    expect(host(harness).querySelector('[data-testid="camp-skeleton"]')).toBeNull();
  });

  it('falls back to the error view when the camp never answers', async () => {
    const harness = await open();
    vi.advanceTimersByTime(PAGE_LOAD_WAIT_MS);
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
  });
});

describe('PublicCampPage skeleton names', () => {
  const NAMES = {
    organization: { slug: ORG_SLUG, name: 'Gulf Coast Sport & Social' },
    camp: { slug: 'junior-beach-volleyball-camp', name: 'Junior Beach Volleyball Camp' },
  };
  const SKELETON = '[data-testid="camp-skeleton"]';

  async function loading(state?: Record<string, unknown>): Promise<HTMLElement> {
    const harness = await open(CAMP_PATH, state);
    await settle(harness);
    return host(harness).querySelector<HTMLElement>(SKELETON)!;
  }

  it('shows the names the navigation carried, in place of the bars, while the data is on its way', async () => {
    const skeleton = await loading(NAMES);
    expect(
      [...skeleton.querySelectorAll('[data-testid="skeleton-breadcrumb"] li > span')].map(text),
    ).toEqual(['Gulf Coast Sport & Social']);
    expect(text(skeleton.querySelector('[data-testid="skeleton-heading"]'))).toBe(
      'Junior Beach Volleyball Camp',
    );
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).toBeNull();
  });

  it.each([
    ['another camp’s slug', { ...NAMES, camp: { ...NAMES.camp, slug: 'fall-break-camp' } }],
    ['a field that is not text', { ...NAMES, camp: { ...NAMES.camp, name: 4 } }],
    ['the team page’s state', { registered: true }],
  ])('shows the bars for %s', async (_, state) => {
    const skeleton = await loading(state);
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb"]')).toBeNull();
    expect(text(skeleton.querySelector('[data-testid="skeleton-heading"]'))).toBe('');
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).not.toBeNull();
  });

  it('shows the bars when the navigation carried no state, and keeps the names out of the accessibility tree', async () => {
    const bars = await loading();
    expect(bars.querySelector('[data-testid="skeleton-breadcrumb-row"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const named = await loading(NAMES);
    expect(
      named.querySelector('[data-testid="skeleton-breadcrumb"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      named.querySelector('[data-testid="skeleton-heading"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });
});

describe('PublicCampPage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb with the organization, and the camp as the only h1', () => {
    const main = host(harness).querySelector('main');
    const links = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] a') ?? [])];
    expect(links.map(text)).toEqual(['Gulf Coast Sport & Social']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([`/organizations/${ORG_SLUG}`]);
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Junior Beach Volleyball Camp');
  });

  it('renders helm breadcrumb, with no current-page item because the h1 names the camp', () => {
    expect(slotsOf(host(harness).querySelector('main nav[aria-label="Breadcrumb"]'))).toEqual([
      'breadcrumb',
      'breadcrumb-list',
      'breadcrumb-item',
      'breadcrumb-link',
    ]);
  });

  it('writes the ages and then the sport and place under the h1', () => {
    const h1 = host(harness).querySelector('main h1');
    expect(text(h1?.nextElementSibling)).toBe('Ages 9 to 14');
    expect(text(h1?.nextElementSibling?.nextElementSibling)).toBe(
      'Beach volleyball · North Beach Sand Courts',
    );
  });

  it('puts the sessions after the h1 and before the details', () => {
    const main = host(harness).querySelector('main')!;
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    const sessions = main.querySelector('#sessions')!;
    const details = main.querySelector('section[aria-labelledby="details-heading"]')!;
    expect(main.querySelector('h1')!.compareDocumentPosition(sessions) & follows).toBeTruthy();
    expect(sessions.compareDocumentPosition(details) & follows).toBeTruthy();
  });

  it('draws the sessions in a bare helm card', () => {
    const cards = host(harness).querySelectorAll('#sessions [data-slot="card"]');
    expect(cards).toHaveLength(1);
    expectBareCard(cards[0], 'overflow-hidden');
  });

  it('lists each session in date order with its dates, daily times, places, and deadline', () => {
    expect(text(host(harness).querySelector('#sessions h2'))).toBe('Sessions');
    const rows = sessionRows(harness);
    expect(rows.map((row) => text(row.querySelector('h3')))).toEqual([
      'Week 1',
      'Week 2',
      'Week 3',
    ]);
    expect(spaced(rows[0])).toBe(
      'Week 1 Registration open Jul 5 – Jul 9, 2027 9 AM to 12 PM 15 places left Registration closes Jul 1, 2027',
    );
    expect(spaced(rows[1])).toContain('1 place left');
    expect(spaced(rows[2])).toBe(
      'Week 3 Jul 19 – Jul 23, 2027 Full Registration closes Jul 15, 2027',
    );
  });

  it('marks up each date with its stored value', () => {
    const times = [...sessionRows(harness)[0].querySelectorAll('time')];
    expect(times.map((time) => [text(time), time.getAttribute('datetime')])).toEqual([
      ['Jul 5', '2027-07-05'],
      ['Jul 9, 2027', '2027-07-09'],
      ['Jul 1, 2027', '2027-07-01'],
    ]);
  });

  it('lists the ages and the location with its address', () => {
    expect(text(host(harness).querySelector('section[aria-labelledby="details-heading"] h2'))).toBe(
      'Camp details',
    );
    const rows = [...host(harness).querySelectorAll('main dl > div')].map((row) => [
      text(row.querySelector('dt')),
      [...row.querySelectorAll('dd')].map(spaced),
    ]);
    expect(rows).toEqual([
      ['Age range', ['Ages 9 to 14']],
      ['Location', ['North Beach Sand Courts 3500 Sandcourt Ln, Corpus Christi, TX 78402']],
    ]);
  });

  it('writes several locations as Locations, and nothing for none', async () => {
    emit({
      ...JUNIOR_CAMP,
      locations: [
        { name: 'Bayside Athletic Complex', address: '1 Bay Road, Corpus Christi, TX 78412' },
        { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln' },
      ],
    });
    await settle(harness);
    expect(text(host(harness).querySelectorAll('main dl > div dt')[1])).toBe('Locations');
    emit({ ...JUNIOR_CAMP, locations: [] });
    await settle(harness);
    expect(host(harness).querySelectorAll('main dl > div')).toHaveLength(1);
  });

  it('writes one age for a camp with a single age', async () => {
    emit({ ...JUNIOR_CAMP, minimumAge: 10, maximumAge: 10 });
    await settle(harness);
    expect(text(host(harness).querySelector('main h1')?.nextElementSibling)).toBe('Age 10');
  });

  it('offers no way to register and shows no price', () => {
    expect(host(harness).querySelector('main a[href*="register"]')).toBeNull();
    expect(text(host(harness).querySelector('main'))).not.toMatch(/\$|price|fee|register for/i);
  });

  it('sets the title and the Open Graph tags from the result, with the camp’s path as canonical', () => {
    const title = 'Junior Beach Volleyball Camp | Gulf Coast Sport & Social | Omni League';
    expect(TestBed.inject(Title).getTitle()).toBe(title);
    expect(metaContent('og:title')).toBe(title);
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Beach volleyball · Ages 9 to 14. 3 sessions, Jul 5 – Jul 23, 2027.',
    );
    expect(metaContent('og:url')).toBe(`${window.location.origin}${CAMP_PATH}`);
    expect(canonical()).toBe(`${window.location.origin}${CAMP_PATH}`);
  });

  it('writes one session in the singular in the description', async () => {
    emit({ ...JUNIOR_CAMP, sessions: [JUNIOR_CAMP.sessions[0]] });
    await settle(harness);
    expect(metaContent('og:description')).toBe(
      'Beach volleyball · Ages 9 to 14. 1 session, Jul 5 – Jul 9, 2027.',
    );
  });

  it('renders in the public layout: top bar and footer, no organization sidebar', () => {
    const root = host(harness);
    expect(root.querySelector('app-public-layout')).not.toBeNull();
    expect(root.querySelector('app-shell')).toBeNull();
    expect(root.querySelectorAll('footer')).toHaveLength(1);
  });

  it('updates in place when the places change on the server', async () => {
    const h1 = host(harness).querySelector('main h1');
    const sessions = JUNIOR_CAMP.sessions.map((session) => ({ ...session, placesLeft: 3 }));
    emit({ ...JUNIOR_CAMP, sessions });
    await settle(harness);
    expect(spaced(sessionRows(harness)[0])).toContain('3 places left');
    expect(spaced(sessionRows(harness)[2])).toContain('3 places left');
    expect(host(harness).querySelector('main h1')).toBe(h1);
  });
});

describe('PublicCampPage session status', () => {
  const badge = (harness: RouterTestingHarness, index: number) =>
    text(sessionRows(harness)[index].querySelector('[data-slot="badge"]'));

  it('reads Registration open before the deadline, and Full with no badge at its places', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    expect(badge(harness, 0)).toBe('Registration open');
    expect(sessionRows(harness)[2].querySelector('[data-slot="badge"]')).toBeNull();
    expect(text(sessionRows(harness)[2].querySelector('[data-slot="session-places"]'))).toBe(
      'Full',
    );
  });

  it.each([
    ['2027-07-01', 'Registration open'],
    ['2027-07-02', 'Registration closed'],
    ['2027-07-05', 'In progress'],
    ['2027-07-10', 'Ended'],
  ])('on %s the first session reads %s', async (date, label) => {
    vi.setSystemTime(at(date));
    const harness = await open();
    emit();
    await settle(harness);
    expect(badge(harness, 0)).toBe(label);
  });

  it('reads Registration closed once the clock passes the deadline after the page was drawn open', async () => {
    vi.setSystemTime(at('2027-07-01'));
    const harness = await open();
    emit();
    await settle(harness);
    expect(badge(harness, 0)).toBe('Registration open');

    vi.advanceTimersByTime(24 * HOUR);
    await settle(harness);
    expect(badge(harness, 0)).toBe('Registration closed');
    expect(spaced(sessionRows(harness)[0])).not.toContain('Registration open');
  });

  it('reads Full for a session at its places, and Registration closed beside it once the deadline passes', async () => {
    vi.setSystemTime(at('2027-07-16'));
    const harness = await open();
    emit();
    await settle(harness);
    expect(text(sessionRows(harness)[2].querySelector('[data-slot="session-places"]'))).toBe(
      'Full',
    );
    expect(badge(harness, 2)).toBe('Registration closed');
  });
});

describe('PublicCampPage not found and failures', () => {
  it('shows the not-found view for a null camp, with no breadcrumb and no meta', async () => {
    const harness = await open();
    emit(null);
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(canonical()).toBeNull();
  });

  it('shows the server-error view when the query fails, and keeps the page path as Try again', async () => {
    const harness = await open(`${CAMP_PATH}?ott=SECRET`);
    subscription().fail(new Error('connection lost'));
    await settle(harness);
    const view = host(harness).querySelector('app-server-error-view');
    expect(view).not.toBeNull();
    expect(view?.querySelector('a')?.getAttribute('href')).toBe(CAMP_PATH);
  });
});
