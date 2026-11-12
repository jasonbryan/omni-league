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
import { slotsOf } from '../../ui/testing/helm-slots';
import { expectBareCard } from '../../ui/testing/card';
import { PublicTournamentPage } from './public-tournament-page';
import {
  at,
  BEACH_OPEN,
  ORG_SLUG,
  TOURNAMENT_ARGS,
  TOURNAMENT_PATH,
} from './testing/tournament-data';

const TOURNAMENT = 'tournaments:getPublicPage';
const HOUR = 60 * 60 * 1000;

let client: FakeConvexClient;

async function open(url = TOURNAMENT_PATH, state?: Record<string, unknown>) {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'organizations/:orgSlug/tournaments/:tournamentSlug',
          component: PublicTournamentPage,
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
  const active = client.activeSubscriptions.filter((s) => s.name === TOURNAMENT);
  expect(active).toHaveLength(1);
  return active[0];
}

function emit(result: unknown = BEACH_OPEN): void {
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
const card = (harness: RouterTestingHarness) => host(harness).querySelector('#registration');

function details(harness: RouterTestingHarness): [string, string[]][] {
  return [...host(harness).querySelectorAll('main dl > div')].map((row) => [
    text(row.querySelector('dt')),
    [...row.querySelectorAll('dd')].map(spaced),
  ]);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-04-01'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('PublicTournamentPage queries', () => {
  it('asks for the tournament with the route’s slugs only', async () => {
    await open(`${TOURNAMENT_PATH}?ott=SECRET&utm_source=x#registration`);
    expect(client.activeSubscriptions.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: TOURNAMENT, args: TOURNAMENT_ARGS },
    ]);
  });
});

describe('PublicTournamentPage loading', () => {
  it('shows the skeleton with its status and no heading until the result has arrived', async () => {
    const harness = await open();
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('main nav')).toBeNull();
    const skeleton = host(harness).querySelector('[data-testid="tournament-skeleton"]');
    expect(text(skeleton?.querySelector('[role="status"]'))).toBe('Loading the tournament.');
    expect(skeleton?.querySelector('[role="status"]')?.classList).toContain('sr-only');
    emit();
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Beach Open');
    expect(host(harness).querySelector('[data-testid="tournament-skeleton"]')).toBeNull();
  });

  it('falls back to the error view when the tournament never answers', async () => {
    const harness = await open();
    vi.advanceTimersByTime(PAGE_LOAD_WAIT_MS);
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
  });
});

describe('PublicTournamentPage skeleton names', () => {
  const NAMES = {
    organization: { slug: ORG_SLUG, name: 'Gulf Coast Sport & Social' },
    tournament: { slug: 'gulf-coast-beach-open', name: 'Gulf Coast Beach Open' },
  };
  const SKELETON = '[data-testid="tournament-skeleton"]';

  async function loading(state?: Record<string, unknown>): Promise<HTMLElement> {
    const harness = await open(TOURNAMENT_PATH, state);
    await settle(harness);
    return host(harness).querySelector<HTMLElement>(SKELETON)!;
  }

  it('shows the names the navigation carried, in place of the bars, while the data is on its way', async () => {
    const skeleton = await loading(NAMES);
    expect(
      [...skeleton.querySelectorAll('[data-testid="skeleton-breadcrumb"] li > span')].map(text),
    ).toEqual(['Gulf Coast Sport & Social', 'Tournaments']);
    expect(text(skeleton.querySelector('[data-testid="skeleton-heading"]'))).toBe(
      'Gulf Coast Beach Open',
    );
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).toBeNull();
  });

  it.each([
    [
      'another tournament’s slug',
      { ...NAMES, tournament: { ...NAMES.tournament, slug: 'winter-doubles-classic' } },
    ],
    [
      'another organization’s slug',
      { ...NAMES, organization: { ...NAMES.organization, slug: 'lakeshore-sand-league' } },
    ],
    ['a field that is not text', { ...NAMES, tournament: { ...NAMES.tournament, name: 4 } }],
    ['the team page’s state', { registered: true }],
  ])('shows the bars for %s', async (_, state) => {
    const skeleton = await loading(state);
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb"]')).toBeNull();
    expect(text(skeleton.querySelector('[data-testid="skeleton-heading"]'))).toBe('');
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).not.toBeNull();
  });

  it('shows the bars when the navigation carried no state', async () => {
    const skeleton = await loading();
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb"]')).toBeNull();
    expect(skeleton.querySelector('[data-testid="skeleton-breadcrumb-row"]')).not.toBeNull();
  });

  it('keeps the names out of the accessibility tree, which the status announces', async () => {
    const skeleton = await loading(NAMES);
    expect(
      skeleton.querySelector('[data-testid="skeleton-breadcrumb"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      skeleton.querySelector('[data-testid="skeleton-heading"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });
});

describe('PublicTournamentPage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb organization then Tournaments, and the tournament as the only h1', () => {
    const main = host(harness).querySelector('main');
    const links = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] a') ?? [])];
    expect(links.map(text)).toEqual(['Gulf Coast Sport & Social', 'Tournaments']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/organizations/${ORG_SLUG}`,
      `/organizations/${ORG_SLUG}#tournaments`,
    ]);
    expect(main?.querySelector('nav[aria-label="Breadcrumb"] [aria-current]')).toBeNull();
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Gulf Coast Beach Open');
  });

  it('renders helm breadcrumb, with no current-page item because the h1 names the tournament', () => {
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

  it('writes the division and then the sport and place under the h1', () => {
    const h1 = host(harness).querySelector('main h1');
    expect(text(h1?.nextElementSibling)).toBe('Coed · 2v2 · Open');
    expect(text(h1?.nextElementSibling?.nextElementSibling)).toBe(
      'Beach volleyball · North Beach Sand Courts',
    );
  });

  it('puts the registration card after the h1 and before the details', () => {
    const main = host(harness).querySelector('main')!;
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    const registration = main.querySelector('#registration')!;
    const details = main.querySelector('section[aria-labelledby="details-heading"]')!;
    expect(main.querySelector('h1')!.compareDocumentPosition(registration) & follows).toBeTruthy();
    expect(registration.compareDocumentPosition(details) & follows).toBeTruthy();
  });

  it('draws the registration card as a bare helm card that sticks from lg', () => {
    const cards = host(harness).querySelectorAll('#registration [data-slot="card"]');
    expect(cards).toHaveLength(1);
    expectBareCard(cards[0], 'p-5 md:p-6 lg:sticky lg:top-24');
  });

  it('shows the open card with the deadline and no action', () => {
    expect(text(card(harness)?.querySelector('h2'))).toBe('Registration');
    expect(spaced(card(harness))).toContain('Registration open · closes Jun 5, 2027');
    expect(card(harness)?.querySelector('a, button')).toBeNull();
  });

  it('lists the dates, team limits, deadline, and location with its address', () => {
    expect(text(host(harness).querySelector('section[aria-labelledby="details-heading"] h2'))).toBe(
      'Tournament details',
    );
    expect(details(harness)).toEqual([
      ['Dates', ['Jun 12 – Jun 13, 2027']],
      ['Teams', ['Up to 16 teams', 'Teams of at least 2 players']],
      ['Registration closes', ['Jun 5, 2027']],
      ['Location', ['North Beach Sand Courts 3500 Sandcourt Ln, Corpus Christi, TX 78402']],
    ]);
  });

  it('marks up each date with its stored value', () => {
    const times = [...host(harness).querySelectorAll('main dl time')];
    expect(times.map((time) => [text(time), time.getAttribute('datetime')])).toEqual([
      ['Jun 12', '2027-06-12'],
      ['Jun 13, 2027', '2027-06-13'],
      ['Jun 5, 2027', '2027-06-05'],
    ]);
  });

  it('writes one date for a one-day tournament, and several locations as Locations', async () => {
    emit({
      ...BEACH_OPEN,
      endDate: BEACH_OPEN.startDate,
      locations: [
        { name: 'Bayside Athletic Complex', address: '1 Bay Road, Corpus Christi, TX 78412' },
        { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln' },
      ],
    });
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', ['Jun 12, 2027']]);
    expect(details(harness)[3]).toEqual([
      'Locations',
      [
        'Bayside Athletic Complex 1 Bay Road, Corpus Christi, TX 78412',
        'North Beach Sand Courts 3500 Sandcourt Ln',
      ],
    ]);
  });

  it('shows no price', () => {
    expect(text(host(harness).querySelector('main'))).not.toMatch(/\$|price|fee/i);
  });

  it('sets the title and the Open Graph tags from the result, with the tournament’s path as canonical', () => {
    const title = 'Gulf Coast Beach Open | Gulf Coast Sport & Social | Omni League';
    expect(TestBed.inject(Title).getTitle()).toBe(title);
    expect(metaContent('og:title')).toBe(title);
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Jun 12 – Jun 13, 2027. Beach volleyball · Coed · 2v2 · Open. Up to 16 teams.',
    );
    expect(metaContent('og:url')).toBe(`${window.location.origin}${TOURNAMENT_PATH}`);
    expect(canonical()).toBe(`${window.location.origin}${TOURNAMENT_PATH}`);
  });

  it('renders in the public layout: top bar and footer, no organization sidebar', () => {
    const root = host(harness);
    expect(root.querySelector('app-public-layout')).not.toBeNull();
    expect(root.querySelector('app-shell')).toBeNull();
    expect(root.querySelectorAll('footer')).toHaveLength(1);
  });

  it('updates in place when the dates change on the server', async () => {
    const h1 = host(harness).querySelector('main h1');
    emit({ ...BEACH_OPEN, startDate: '2027-06-19', endDate: '2027-06-20', maximumTeams: 8 });
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', ['Jun 19 – Jun 20, 2027']]);
    expect(details(harness)[1]).toEqual([
      'Teams',
      ['Up to 8 teams', 'Teams of at least 2 players'],
    ]);
    expect(host(harness).querySelector('main h1')).toBe(h1);
  });
});

describe('PublicTournamentPage registration card', () => {
  it.each([
    ['2027-05-01', 'Registration open · closes Jun 5, 2027'],
    ['2027-06-05', 'Registration open · closes Jun 5, 2027'],
    ['2027-06-06', 'Registration closed'],
    ['2027-06-20', 'Registration closed'],
  ])('on %s the card reads %s', async (date, label) => {
    vi.setSystemTime(at(date));
    const harness = await open();
    emit();
    await settle(harness);
    expect(text(card(harness)?.querySelector('p'))).toBe(label);
  });

  it('names the deadline on the closed card, with no action', async () => {
    vi.setSystemTime(at('2027-06-06'));
    const harness = await open();
    emit();
    await settle(harness);
    expect(spaced(card(harness))).toContain('The deadline was Jun 5, 2027.');
    expect(spaced(card(harness))).not.toContain('Registration open');
    expect(card(harness)?.querySelector('a, button')).toBeNull();
  });

  it('shows Registration closed once the clock passes the deadline after the page was drawn open', async () => {
    vi.setSystemTime(at('2027-06-05'));
    const harness = await open();
    emit();
    await settle(harness);
    expect(spaced(card(harness))).toContain('Registration open · closes Jun 5, 2027');

    vi.advanceTimersByTime(24 * HOUR);
    await settle(harness);
    expect(spaced(card(harness))).toContain('Registration closed');
    expect(spaced(card(harness))).not.toContain('Registration open');
  });
});

describe('PublicTournamentPage not found and failures', () => {
  it('shows the not-found view for a null tournament, with no breadcrumb and no meta', async () => {
    const harness = await open();
    emit(null);
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(canonical()).toBeNull();
  });

  it('shows the server-error view when the query fails, and keeps the page path as Try again', async () => {
    const harness = await open(`${TOURNAMENT_PATH}?ott=SECRET`);
    subscription().fail(new Error('connection lost'));
    await settle(harness);
    const view = host(harness).querySelector('app-server-error-view');
    expect(view).not.toBeNull();
    expect(view?.querySelector('a')?.getAttribute('href')).toBe(TOURNAMENT_PATH);
  });
});
