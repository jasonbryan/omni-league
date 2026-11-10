import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { FindPage } from './find-page';
import {
  at,
  COED_RESULTS,
  GIRLS_ROOKIES_ROW,
  GIRLS_SELECT_ROW,
  NO_RESULTS,
  OPEN_DAY,
  SOCCER_FACETS,
  sportResults,
} from './testing/find-data';
import { ORGANIZATIONS } from './testing/organizations-data';

let client: FakeConvexClient;

async function open(url: string): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'leagues', component: FindPage },
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

const names = () => client.activeSubscriptions.map((s) => s.name);

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const head = () => TestBed.inject(DOCUMENT).head;
const robots = () => head().querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const results = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main section[aria-labelledby="results-heading"]');
const rowNames = (harness: RouterTestingHarness) =>
  [...(results(harness)?.querySelectorAll('ul > li h3') ?? [])].map(text);
const bar = (harness: RouterTestingHarness) =>
  host(harness).querySelector('form[aria-label="Filter leagues"]');
const chips = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('nav[aria-label="Sport"] a')].map((a) => ({
    name: text(a),
    href: a.getAttribute('href'),
    current: a.getAttribute('aria-current'),
  }));
const pills = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('ul[aria-label="Active filters"] a')].map((a) => ({
    label: text(a).replace(/: remove the .* filter$/, ''),
    href: a.getAttribute('href'),
  }));
const dimensions = (harness: RouterTestingHarness) =>
  [...(bar(harness)?.querySelectorAll('[data-filter-buttons] .hidden button') ?? [])].map(text);
const count = (harness: RouterTestingHarness) =>
  text(bar(harness)?.querySelector('p[role="status"]'));

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

describe('FindPage sport chips', () => {
  it('shows All sports current and a link per sport before a search, beside the organizations', async () => {
    const harness = await open('/leagues');
    expect(chips(harness)).toEqual([
      { name: 'All sports', href: '/leagues', current: 'page' },
      { name: 'Beach volleyball', href: '/leagues?sport=beach-volleyball', current: null },
      { name: 'Soccer', href: '/leagues?sport=soccer', current: null },
      { name: 'Softball', href: '/leagues?sport=softball', current: null },
    ]);
    expect(names()).toEqual(['search:organizations']);
  });

  it('marks the chosen sport current and keeps q in every link', async () => {
    const harness = await open('/leagues?q=coed&sport=beach-volleyball');
    expect(chips(harness)).toEqual([
      { name: 'All sports', href: '/leagues?q=coed', current: null },
      {
        name: 'Beach volleyball',
        href: '/leagues?q=coed&sport=beach-volleyball',
        current: 'page',
      },
      { name: 'Soccer', href: '/leagues?q=coed&sport=soccer', current: null },
      { name: 'Softball', href: '/leagues?q=coed&sport=softball', current: null },
    ]);
  });
});

describe('FindPage queries by sport', () => {
  it('asks the sport browse with no search, and nothing else', async () => {
    await open('/leagues?sport=soccer');
    expect(names()).toEqual(['search:leaguesBySport']);
    expect(subscription('search:leaguesBySport').args).toEqual({ sport: 'soccer', page: 1 });
  });

  it('asks the search with the sport when there is a q', async () => {
    await open('/leagues?q=coed&sport=beach-volleyball');
    expect(names()).toEqual(['search:leagues']);
    expect(subscription('search:leagues').args).toEqual({ q: 'coed', sport: 'beachVolleyball' });
  });

  it('adds the division filters and the page to the args', async () => {
    await open('/leagues?sport=soccer&age=u10&gender=girls&page=2&utm_source=x');
    expect(subscription('search:leaguesBySport').args).toEqual({
      sport: 'soccer',
      gender: ['womens'],
      ageGroup: ['u10'],
      page: 2,
    });
  });

  it('adds the filters to a search, and gender and age with no sport', async () => {
    await open('/leagues?q=coed&age=over40&format=4v4&level=bb');
    expect(subscription('search:leagues').args).toEqual({ q: 'coed', ageGroup: ['over40'] });
  });

  it('ignores a level that is not one of the sport, and a sport it does not know', async () => {
    await open('/leagues?sport=softball&level=bb');
    expect(subscription('search:leaguesBySport').args).toEqual({ sport: 'softball', page: 1 });
    TestBed.resetTestingModule();
    await open('/leagues?sport=cricket&age=u10');
    expect(names()).toEqual(['search:organizations']);
  });

  it('never writes an ignored value into the page', async () => {
    const harness = await open('/leagues?sport=softball&level=bb&format=4v4&gender=nope');
    subscription('search:leaguesBySport').emit(
      sportResults([], {}, [{ gender: 'coed', playersPerSide: 10, level: 'rec' }]),
    );
    await settle(harness);
    const html = host(harness).querySelector('main')!.innerHTML;
    expect(html).not.toContain('level=bb');
    expect(html).not.toContain('4v4');
    expect(html).not.toContain('nope');
  });

  it('shows no filter bar with no search and no sport, and keeps no filter out of sight', async () => {
    const harness = await open('/leagues?gender=girls&age=u10');
    expect(bar(harness)).toBeNull();
    expect(names()).toEqual(['search:organizations']);
    expect(host(harness).querySelector('main form[role="search"] input[type="hidden"]')).toBeNull();
    expect(chips(harness)[2].href).toBe('/leagues?sport=soccer');
  });
});

describe('FindPage filter bar', () => {
  it('offers only Gender and Age group with no sport', async () => {
    const harness = await open('/leagues?q=soccer');
    subscription('search:leagues').emit({ ...COED_RESULTS, facets: SOCCER_FACETS });
    await settle(harness);
    expect(dimensions(harness)).toEqual(['Gender', 'Age group']);
  });

  it('offers Format and Level once a sport is chosen', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    expect(dimensions(harness)).toEqual(['Gender', 'Format', 'Level', 'Age group']);
  });

  it('shows the chosen values on the dimension buttons, with Girls for a youth age group', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10&gender=girls&level=rec');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    expect(dimensions(harness)).toEqual([
      'Gender: Girls',
      'Format',
      'Level: Rec',
      'Age group: U10',
    ]);
  });

  it('keeps the dimensions while another sport’s leagues load, once they have arrived', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/leagues?sport=softball');
    await settle(harness);
    expect(bar(harness)).not.toBeNull();
    expect(count(harness)).toBe('');
  });

  it('shows a pill for each chosen filter, each removing only itself and keeping the sport', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10&gender=girls');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW, GIRLS_SELECT_ROW]));
    await settle(harness);
    expect(pills(harness)).toEqual([
      { label: 'Gender: Girls', href: '/leagues?sport=soccer&age=u10' },
      { label: 'U10', href: '/leagues?sport=soccer&gender=womens' },
    ]);
    const clear = [...host(harness).querySelectorAll('form a')].find(
      (a) => text(a) === 'Clear all',
    );
    expect(clear?.getAttribute('href')).toBe('/leagues?sport=soccer');
  });

  it('keeps the search in the pills and in Clear all', async () => {
    const harness = await open('/leagues?q=select&sport=soccer&age=u10');
    subscription('search:leagues').emit({
      rows: [GIRLS_SELECT_ROW],
      more: false,
      facets: SOCCER_FACETS,
    });
    await settle(harness);
    expect(pills(harness)).toEqual([{ label: 'U10', href: '/leagues?q=select&sport=soccer' }]);
  });

  it('counts the matches of the filters out of the leagues before them', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10&gender=girls');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW, GIRLS_SELECT_ROW]));
    await settle(harness);
    expect(count(harness)).toBe('2 of 5 leagues');
  });

  it('counts every league of the sport when no filter is chosen', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW], { total: 5 }));
    await settle(harness);
    expect(count(harness)).toBe('5 leagues');
  });
});

describe('FindPage sport results', () => {
  it('lists the rows of the page with their division, and no count line of a search', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW, GIRLS_SELECT_ROW]));
    await settle(harness);
    expect(rowNames(harness)).toEqual(['U10 Girls Fall Rec', 'U10 Girls Select']);
    expect(text(results(harness)!.querySelector('li'))).toContain('Girls · 7v7 · Rec · U10');
    expect(results(harness)!.querySelector('[role="status"]')).toBeNull();
  });

  it('shows numbered pages whose links keep the sport and the filters', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10&gender=girls&page=2');
    subscription('search:leaguesBySport').emit(
      sportResults([GIRLS_ROOKIES_ROW], { page: 2, pageCount: 3, total: 11 }),
    );
    await settle(harness);
    const nav = host(harness).querySelector('nav[aria-label="Leagues pages"]')!;
    expect(
      [...nav.querySelectorAll('a')].map((a) => [
        text(a).replace(/\s+/g, ' '),
        a.getAttribute('href'),
      ]),
    ).toEqual([
      ['Previous page', '/leagues?sport=soccer&gender=girls&age=u10'],
      ['Page 1', '/leagues?sport=soccer&gender=girls&age=u10'],
      ['Page 2', '/leagues?sport=soccer&gender=girls&age=u10&page=2'],
      ['Page 3', '/leagues?sport=soccer&gender=girls&age=u10&page=3'],
      ['Next page', '/leagues?sport=soccer&gender=girls&age=u10&page=3'],
    ]);
    expect(text(nav)).toContain('6–10 of 11');
  });

  it('shows no page control for a single page', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    expect(host(harness).querySelector('nav[aria-label="Leagues pages"]')).toBeNull();
  });

  it('keeps the previous page on screen, marked busy, while the next one loads', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(
      sportResults([GIRLS_ROOKIES_ROW], { pageCount: 2, total: 6 }),
    );
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/leagues?sport=soccer&page=2');
    await settle(harness);
    expect(rowNames(harness)).toEqual(['U10 Girls Fall Rec']);
    expect(results(harness)!.querySelector('ul')!.getAttribute('aria-busy')).toBe('true');
    subscription('search:leaguesBySport').emit(
      sportResults([GIRLS_SELECT_ROW], { page: 2, pageCount: 2, total: 6 }),
    );
    await settle(harness);
    expect(rowNames(harness)).toEqual(['U10 Girls Select']);
    expect(results(harness)!.querySelector('ul')!.getAttribute('aria-busy')).toBeNull();
  });

  it('shows the skeleton, not another sport’s rows, while a chip’s sport loads', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/leagues?sport=softball');
    await settle(harness);
    expect(rowNames(harness)).toEqual([]);
    expect(results(harness)!.querySelector('[data-testid="find-skeleton"]')).not.toBeNull();
    expect(results(harness)!.querySelector('[data-testid="find-skeleton"] > span')).toBeNull();
  });

  it('says a sport has no published league when it has none', async () => {
    const harness = await open('/leagues?sport=softball');
    subscription('search:leaguesBySport').emit(sportResults([], {}, []));
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No softball leagues are published yet',
    );
    const all = [...results(harness)!.querySelectorAll('a')].find((a) => text(a) === 'All sports');
    expect(all?.getAttribute('href')).toBe('/leagues');
  });

  it('shows the error alert with Try again to the same view when the sport query fails', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10&page=2');
    subscription('search:leaguesBySport').fail(new Error('down'));
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="alert"]'))).toContain(
      'The search could not be completed.',
    );
    const retry = [...results(harness)!.querySelectorAll('a')].find((a) => text(a) === 'Try again');
    expect(retry?.getAttribute('href')).toBe('/leagues?sport=soccer&age=u10&page=2');
  });
});

describe('FindPage with filters that match no league', () => {
  it('names the filters, offers each removal with its count, and keeps the sport', async () => {
    const harness = await open('/leagues?sport=soccer&gender=womens&age=over40&age=u10');
    subscription('search:leaguesBySport').emit(sportResults([], { total: 0 }));
    await settle(harness);
    const section = results(harness)!;
    expect(text(section.querySelector('[role="status"]'))).toBe(
      'No soccer leagues match these filters',
    );
    expect(text(section)).toContain("Omni League has no women's 40+ or U10 soccer league.");
    const removals = [...section.querySelectorAll('ul a')].map((a) => [
      text(a),
      a.getAttribute('href'),
    ]);
    expect(removals).toEqual([
      ["Remove Women's (4 leagues)", '/leagues?sport=soccer&age=over40&age=u10'],
      ['Remove 40+ (2 leagues)', '/leagues?sport=soccer&gender=girls&age=u10'],
    ]);
    const clear = [...section.querySelectorAll('a')].find((a) => text(a) === 'Clear all');
    expect(clear?.getAttribute('href')).toBe('/leagues?sport=soccer');
  });

  it('offers each filter to remove, and no word suggestions, when leagues hold every word but the filters exclude them', async () => {
    const harness = await open('/leagues?q=coed&sport=soccer&age=u10');
    subscription('search:leagues').emit({ rows: [], more: false, facets: SOCCER_FACETS });
    await settle(harness);
    const section = results(harness)!;
    expect(text(section.querySelector('[role="status"]'))).toBe(
      'No soccer leagues match “coed” with these filters',
    );
    expect(text(section)).not.toContain('Try fewer words');
    expect([...section.querySelectorAll('ul a')].map((a) => a.getAttribute('href'))).toEqual([
      '/leagues?q=coed&sport=soccer',
    ]);
  });

  it('keeps the sport and the filters in each “Try fewer words” link', async () => {
    const harness = await open('/leagues?q=coed+zebra&sport=soccer&age=u10');
    subscription('search:leagues').emit({
      rows: [],
      more: false,
      facets: [],
      suggestions: ['coed'],
    });
    await settle(harness);
    const section = results(harness)!;
    expect(text(section.querySelector('[role="status"]'))).toBe(
      'No soccer leagues match “coed zebra”',
    );
    const links = [...section.querySelectorAll('ul a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/leagues?q=coed&sport=soccer&age=u10']);
    const clear = [...section.querySelectorAll('a')].find((a) => text(a) === 'Clear the search');
    expect(clear?.getAttribute('href')).toBe('/leagues?sport=soccer&age=u10');
  });
});

describe('FindPage search results with a sport', () => {
  it('names the sport in the count line', async () => {
    const harness = await open('/leagues?q=coed&sport=beach-volleyball');
    subscription('search:leagues').emit({ ...COED_RESULTS, facets: SOCCER_FACETS });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      '3 beach volleyball leagues match “coed”',
    );
  });

  it('keeps the sport and the filters when the search field submits', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10&gender=girls');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    const form = host(harness).querySelector<HTMLFormElement>('main form[role="search"]')!;
    const hidden = [...form.querySelectorAll('input[type="hidden"]')].map((input) => [
      input.getAttribute('name'),
      input.getAttribute('value'),
    ]);
    expect(hidden).toEqual([
      ['sport', 'soccer'],
      ['gender', 'girls'],
      ['age', 'u10'],
    ]);
    const field = form.querySelector<HTMLInputElement>('input[name="q"]')!;
    field.value = 'turf';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/leagues?q=turf&sport=soccer&gender=girls&age=u10');
  });

  it('shows the organizations list only with no search and no sport', async () => {
    const harness = await open('/leagues?sport=soccer');
    expect(host(harness).querySelector('app-find-organizations')).toBeNull();
    TestBed.resetTestingModule();
    const all = await open('/leagues');
    subscription('search:organizations').emit(ORGANIZATIONS);
    await settle(all);
    expect(host(all).querySelector('app-find-organizations')).not.toBeNull();
  });

  it('does not leak a search into the sport browse', async () => {
    await open('/leagues?q=%20&sport=soccer');
    expect(names()).toEqual(['search:leaguesBySport']);
  });
});

describe('FindPage meta by sport', () => {
  it('is indexable, with its own canonical and a title naming the sport, for a sport alone', async () => {
    const harness = await open('/leagues?sport=soccer');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    expect(robots()).toBeNull();
    expect(canonical()).toBe(`${location.origin}/leagues?sport=soccer`);
    expect(TestBed.inject(Title).getTitle()).toBe('Soccer | Find a league | Omni League');
  });

  it('adds the page to the canonical above page 1, from the result', async () => {
    const harness = await open('/leagues?sport=soccer&page=2&utm_source=x');
    subscription('search:leaguesBySport').emit(
      sportResults([GIRLS_ROOKIES_ROW], { page: 2, pageCount: 2, total: 6 }),
    );
    await settle(harness);
    expect(canonical()).toBe(`${location.origin}/leagues?sport=soccer&page=2`);
    expect(robots()).toBeNull();
  });

  it('is noindex with the canonical /leagues once a division filter is set', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    expect(robots()).toBe('noindex');
    expect(canonical()).toBe(`${location.origin}/leagues`);
  });

  it('is noindex with the canonical /leagues for a search with a sport', async () => {
    const harness = await open('/leagues?q=coed&sport=soccer');
    subscription('search:leagues').emit(NO_RESULTS);
    await settle(harness);
    expect(robots()).toBe('noindex');
    expect(canonical()).toBe(`${location.origin}/leagues`);
  });

  it('ignores a level the sport does not have, so the view stays indexable', async () => {
    const harness = await open('/leagues?sport=softball&level=bb');
    subscription('search:leaguesBySport').emit(sportResults([], {}, []));
    await settle(harness);
    expect(robots()).toBeNull();
    expect(canonical()).toBe(`${location.origin}/leagues?sport=softball`);
  });
});

describe('FindPage when the connection drops after a sport view has loaded', () => {
  it('keeps the rows and the filters, and shows the saved-copy note only for a copy it read', async () => {
    const harness = await open('/leagues?sport=soccer&age=u10');
    subscription('search:leaguesBySport').emit(sportResults([GIRLS_ROOKIES_ROW]));
    await settle(harness);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    await settle(harness);
    expect(rowNames(harness)).toEqual(['U10 Girls Fall Rec']);
    expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    expect(bar(harness)).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('keeps a view with no league, and the chips', async () => {
    const harness = await open('/leagues?sport=softball&age=u10');
    subscription('search:leaguesBySport').emit(sportResults([], { total: 0 }, []));
    await settle(harness);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    await settle(harness);
    expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    expect(chips(harness)).toHaveLength(4);
    vi.restoreAllMocks();
  });
});
