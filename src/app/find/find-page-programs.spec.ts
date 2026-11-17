import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { By, Title } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { expectBadge } from '../ui/testing/badge';
import { FindPage } from './find-page';
import {
  at,
  browseResults,
  GULF_OPEN_ROW,
  NO_RESULTS,
  OPEN_DAY,
  SUNDAY_4S_ROW,
} from './testing/find-data';
import type { FindResults } from './find-types';

let client: FakeConvexClient;

async function open(url: string): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'programs', component: FindPage },
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

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const head = () => TestBed.inject(DOCUMENT).head;
const robots = () => head().querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const results = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main section[aria-labelledby="results-heading"]');
const rows = (harness: RouterTestingHarness) => [
  ...(results(harness)?.querySelectorAll('ul > li') ?? []),
];
const typeChips = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('nav[aria-label="Program type"] a')].map((a) => ({
    name: text(a),
    href: a.getAttribute('href'),
    current: a.getAttribute('aria-current'),
  }));

const SEARCH = 'search:programs';
const BROWSE = 'search:programsBrowse';

const MIXED: FindResults = {
  more: false,
  rows: [SUNDAY_4S_ROW, GULF_OPEN_ROW],
  facets: [
    { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
    { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
  ],
  typeCounts: [
    { type: 'league', count: 1 },
    { type: 'tournament', count: 1 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(OPEN_DAY));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  for (const el of head().querySelectorAll(
    'meta[property^="og:"], meta[name="robots"], meta[name="description"], link[rel="canonical"]',
  )) {
    el.remove();
  }
});

describe('Find a program rows', () => {
  it('finds a league and a tournament, each with its type badge', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    const [league, tournament] = rows(harness);
    expect(text(league.querySelector('h3'))).toBe('Sunday Reverse Coed 4s');
    expect(text(league.querySelector('[data-slot="badge"]'))).toBe('League');
    expect(text(tournament.querySelector('h3'))).toBe('Gulf Coast Beach Open');
    expect(text(tournament.querySelector('[data-slot="badge"]'))).toBe('Tournament');
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      '2 programs match “beach”',
    );
  });

  it('shows a tournament row’s dates and Registration open, linking to the tournament page', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    const tournament = rows(harness)[1];
    const status = tournament.querySelector('p:last-of-type [data-slot="badge"]');
    expect(text(status)).toBe('Registration open');
    expectBadge(status, 'secondary', 'fit');
    expect(text(tournament)).toContain('Jul 10');
    expect(text(tournament)).toContain('closes Jul 1');
    expect(tournament.querySelector('h3 a')?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open',
    );
    const link = harness.fixture.debugElement.queryAll(By.css('ul > li h3 a'))[1];
    expect(link.injector.get(RouterLink).state).toEqual({
      organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
      tournament: { slug: 'gulf-coast-beach-open', name: 'Gulf Coast Beach Open' },
    });
  });

  it('shows Registration closed after the deadline, and Full for a tournament at its maximum teams', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit({
      ...MIXED,
      rows: [
        { ...GULF_OPEN_ROW, registrationDeadline: '2027-03-01' },
        { ...GULF_OPEN_ROW, slug: 'full-open', name: 'Full Open', isFull: true },
      ],
    });
    await settle(harness);
    const [closed, full] = rows(harness);
    expect(text(closed.querySelector('p:last-of-type [data-slot="badge"]'))).toBe(
      'Registration closed',
    );
    const badge = full.querySelector('p:last-of-type [data-slot="badge"]');
    expect(text(badge)).toBe('Full');
    expectBadge(badge, 'outline', 'fit');
  });

  it('keeps a league row as before: its division, season status, and league page link', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    const [league] = rows(harness);
    expect(league.querySelector('h3 a')?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s',
    );
    expect(text(league)).toContain('Coed · 4v4 · BB');
    expect(text(league.querySelector('p:last-of-type [data-slot="badge"]'))).toBe(
      'Registration open',
    );
  });
});

describe('Find a program type', () => {
  it('lists All and each type with a match as chips under the form, All current with no type', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    expect(typeChips(harness)).toEqual([
      { name: 'All', href: '/programs?q=beach', current: 'page' },
      { name: 'Leagues', href: '/programs?type=league&q=beach', current: null },
      { name: 'Tournaments', href: '/programs?type=tournament&q=beach', current: null },
    ]);
  });

  it('asks the search with the type and carries it in the form, before the words', async () => {
    const harness = await open('/programs?type=tournament&q=beach');
    expect(subscription(SEARCH).args).toEqual({ q: 'beach', type: 'tournament' });
    const names = [...host(harness).querySelectorAll('main form[role="search"] input')].map((i) =>
      i.getAttribute('name'),
    );
    expect(names.slice(0, 2)).toEqual(['type', 'q']);
    expect(
      host(harness)
        .querySelector('main form[role="search"] input[name="type"]')
        ?.getAttribute('type'),
    ).toBe('hidden');
  });

  it('lists the tournaments of a sport by name without a search', async () => {
    const harness = await open('/programs?type=tournament&sport=beach-volleyball');
    expect(subscription(BROWSE).args).toEqual({
      type: 'tournament',
      sport: 'beachVolleyball',
      page: 1,
    });
    expect(client.activeSubscriptions.map((s) => s.name)).not.toContain(SEARCH);
    subscription(BROWSE).emit({
      ...browseResults([GULF_OPEN_ROW]),
      typeCounts: [{ type: 'tournament', count: 1 }],
    });
    await settle(harness);
    expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
      'Gulf Coast Beach Open',
    ]);
    expect(typeChips(harness).map((chip) => [chip.name, chip.current, chip.href])).toEqual([
      ['All', null, '/programs?sport=beach-volleyball'],
      ['Tournaments', 'page', '/programs?type=tournament&sport=beach-volleyball'],
    ]);
  });

  it('browses by type alone, across sports, rather than listing organizations', async () => {
    await open('/programs?type=league');
    expect(client.activeSubscriptions.map((s) => s.name)).toEqual([BROWSE]);
    expect(subscription(BROWSE).args).toEqual({ type: 'league', page: 1 });
  });

  it('shows a known type with no programs as the current chip, with no results', async () => {
    const harness = await open('/programs?type=camp');
    subscription(BROWSE).emit({
      ...browseResults([], {}, []),
      typeCounts: [{ type: 'league', count: 2 }],
    });
    await settle(harness);
    expect(typeChips(harness)).toEqual([
      { name: 'All', href: '/programs', current: null },
      { name: 'Leagues', href: '/programs?type=league', current: null },
      { name: 'Camps', href: '/programs?type=camp', current: 'page' },
    ]);
    expect(rows(harness)).toEqual([]);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'Find a program does not list camps yet',
    );
    expect(text(results(harness)!.querySelector('p + p'))).toBe(
      'Search the leagues and tournaments instead.',
    );
    const all = [...results(harness)!.querySelectorAll('a')].find((a) => text(a) === 'All types');
    expect(all?.getAttribute('href')).toBe('/programs');
  });

  it('says other types match when a search has no program of the chosen type, and links to every type', async () => {
    const harness = await open('/programs?type=camp&q=beach&sport=soccer');
    subscription(SEARCH).emit({
      rows: [],
      more: false,
      facets: [],
      typeCounts: [{ type: 'league', count: 2 }],
    });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No soccer camps match “beach”',
    );
    expect(text(results(harness))).toContain('2 programs of other types match.');
    const all = [...results(harness)!.querySelectorAll('a')].find(
      (a) => text(a) === 'Show all types',
    );
    expect(all?.getAttribute('href')).toBe('/programs?q=beach&sport=soccer');
    expect(results(harness)!.textContent).not.toContain('Try fewer words');
  });

  it('ignores an unknown type: no chip, no argument, and nowhere in the page', async () => {
    const harness = await open('/programs?type=zzz&q=beach');
    expect(subscription(SEARCH).args).toEqual({ q: 'beach' });
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    expect(host(harness).querySelector('main')?.innerHTML).not.toContain('zzz');
    expect(typeChips(harness).map((chip) => chip.current)).toEqual(['page', null, null]);
  });

  it('keeps the type in each “Try fewer words” link', async () => {
    const harness = await open('/programs?type=tournament&q=beach%20austin');
    subscription(SEARCH).emit({ ...NO_RESULTS, suggestions: ['beach'] });
    await settle(harness);
    const link = [...results(harness)!.querySelectorAll('a')].find((a) => text(a) === 'beach');
    expect(link?.getAttribute('href')).toBe('/programs?type=tournament&q=beach');
  });

  it('shows All and the current type, in the height of the loaded row, while the result loads', async () => {
    const harness = await open('/programs?type=tournament&q=beach');
    expect(typeChips(harness).map((chip) => chip.name)).toEqual(['All', 'Tournaments']);
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    expect(typeChips(harness).map((chip) => chip.name)).toEqual(['All', 'Leagues', 'Tournaments']);
  });

  it('keeps the chip set while the answer to a type press loads, so no chip moves', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    const before = typeChips(harness).map((chip) => chip.name);
    expect(before).toEqual(['All', 'Leagues', 'Tournaments']);

    host(harness)
      .querySelector<HTMLAnchorElement>(
        'nav[aria-label="Program type"] a[href*="type=tournament"]',
      )!
      .click();
    await settle(harness);
    expect(subscription(SEARCH).args).toEqual({ q: 'beach', type: 'tournament' });
    expect(typeChips(harness).map((chip) => [chip.name, chip.current])).toEqual([
      ['All', null],
      ['Leagues', null],
      ['Tournaments', 'page'],
    ]);
  });

  it('keeps the chip set while a browse answer loads after a type press', async () => {
    const harness = await open('/programs?type=league');
    subscription(BROWSE).emit({
      ...browseResults([SUNDAY_4S_ROW]),
      typeCounts: [
        { type: 'league', count: 1 },
        { type: 'tournament', count: 1 },
      ],
    });
    await settle(harness);
    host(harness)
      .querySelector<HTMLAnchorElement>(
        'nav[aria-label="Program type"] a[href*="type=tournament"]',
      )!
      .click();
    await settle(harness);
    expect(typeChips(harness).map((chip) => chip.name)).toEqual(['All', 'Leagues', 'Tournaments']);
  });

  it('offers a chip for each type a search lists before any search, without asking a query for the counts', async () => {
    const harness = await open('/programs');
    expect(typeChips(harness).map((chip) => chip.name)).toEqual(['All', 'Leagues', 'Tournaments']);
    expect(client.activeSubscriptions.map((s) => s.name)).toEqual(['search:organizations']);
  });

  it('stays on the type when a new search is submitted', async () => {
    const harness = await open('/programs?type=tournament&sport=soccer');
    const field = host(harness).querySelector<HTMLInputElement>('main input[name="q"]')!;
    field.value = 'open';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    host(harness).querySelector<HTMLButtonElement>('main form button[type="submit"]')!.click();
    await settle(harness);
    expect(subscription(SEARCH).args).toEqual({ q: 'open', type: 'tournament', sport: 'soccer' });
  });
});

describe('Find a program page meta', () => {
  it('has the title Find a program', async () => {
    await open('/programs');
    expect(TestBed.inject(Title).getTitle()).toBe('Find a program | Omni League');
  });

  it.each([
    ['/programs?q=coed', 'noindex', '/programs'],
    ['/programs?type=league&q=coed', 'noindex', '/programs'],
    ['/programs?sport=soccer', null, '/programs?sport=soccer'],
    ['/programs?type=tournament', null, '/programs?type=tournament'],
    ['/programs?type=tournament&sport=soccer', null, '/programs?type=tournament&sport=soccer'],
    ['/programs?type=league&gender=coed', 'noindex', '/programs'],
  ])('%s is %s with the canonical %s', async (url, noindex, path) => {
    const harness = await open(url);
    const name = url.includes('q=') ? SEARCH : BROWSE;
    subscription(name).emit(
      name === SEARCH
        ? MIXED
        : { ...browseResults([GULF_OPEN_ROW]), typeCounts: [{ type: 'tournament', count: 1 }] },
    );
    await settle(harness);
    expect(robots()).toBe(noindex);
    expect(canonical()).toBe(`${location.origin}${path}`);
  });

  it('keeps page 2 of a browse in the canonical, from the result’s page', async () => {
    const harness = await open('/programs?sport=soccer&page=2');
    subscription(BROWSE).emit(browseResults([GULF_OPEN_ROW], { page: 2, pageCount: 3, total: 11 }));
    await settle(harness);
    expect(robots()).toBeNull();
    expect(canonical()).toBe(`${location.origin}/programs?sport=soccer&page=2`);
  });

  it('names the sport and the type in the title of a browse', async () => {
    const harness = await open('/programs?type=tournament&sport=soccer');
    subscription(BROWSE).emit(browseResults([GULF_OPEN_ROW]));
    await settle(harness);
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Soccer tournaments | Find a program | Omni League',
    );
  });
});
