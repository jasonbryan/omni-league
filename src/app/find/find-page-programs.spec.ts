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
  JUNIOR_CAMP_ROW,
  SERVING_CLINIC_ROW,
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
    expect(subscription(SEARCH).args).toEqual({
      q: 'beach',
      type: 'tournament',
      withCamps: true,
      withTraining: true,
    });
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
      withCamps: true,
      withTraining: true,
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
    expect(subscription(BROWSE).args).toEqual({
      type: 'league',
      withCamps: true,
      withTraining: true,
      page: 1,
    });
  });

  it('shows a type no program has as the current chip, with the no-programs state', async () => {
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
      'No camps are published yet',
    );
    expect(text(results(harness)!.querySelector('p + p'))).toBe(
      'A camp appears here once its organization publishes it.',
    );
    const all = [...results(harness)!.querySelectorAll('a')].find((a) => text(a) === 'All types');
    expect(all?.getAttribute('href')).toBe('/programs');
  });

  it('says no training program is published yet when the training type has none', async () => {
    const harness = await open('/programs?type=training');
    subscription(BROWSE).emit({ ...browseResults([], {}, []), typeCounts: [] });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No training programs are published yet',
    );
    expect(text(results(harness)!.querySelector('p + p'))).toBe(
      'A training program appears here once its organization publishes it.',
    );
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
    expect(subscription(SEARCH).args).toEqual({ q: 'beach', withCamps: true, withTraining: true });
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
    expect(subscription(SEARCH).args).toEqual({
      q: 'beach',
      type: 'tournament',
      withCamps: true,
      withTraining: true,
    });
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
    expect(typeChips(harness).map((chip) => chip.name)).toEqual([
      'All',
      'Leagues',
      'Tournaments',
      'Camps',
      'Training',
    ]);
    expect(client.activeSubscriptions.map((s) => s.name)).toEqual(['search:organizations']);
  });

  it('stays on the type when a new search is submitted', async () => {
    const harness = await open('/programs?type=tournament&sport=soccer');
    const field = host(harness).querySelector<HTMLInputElement>('main input[name="q"]')!;
    field.value = 'open';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    host(harness).querySelector<HTMLButtonElement>('main form button[type="submit"]')!.click();
    await settle(harness);
    expect(subscription(SEARCH).args).toEqual({
      q: 'open',
      type: 'tournament',
      sport: 'soccer',
      withCamps: true,
      withTraining: true,
    });
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

const CAMP_SEARCH: FindResults = {
  more: false,
  rows: [JUNIOR_CAMP_ROW],
  facets: [],
  typeCounts: [{ type: 'camp', count: 1 }],
};

describe('Find a program camps', () => {
  it('shows a camp with the Camp badge, its ages, and the next session’s dates and status, linking to the camp page', async () => {
    const harness = await open('/programs?q=junior');
    subscription(SEARCH).emit(CAMP_SEARCH);
    await settle(harness);
    const [camp] = rows(harness);
    expect(text(camp.querySelector('h3'))).toBe('Junior Beach Volleyball Camp');
    expect(text(camp.querySelector('[data-slot="badge"]'))).toBe('Camp');
    expect(text(camp)).toContain('Ages 9 to 14');
    expect(text(camp)).toContain('Gulf Coast Sport & Social · North Beach Sand Courts');
    const status = camp.querySelector('p:last-of-type [data-slot="badge"]');
    expect(text(status)).toBe('Registration open');
    expectBadge(status, 'secondary', 'fit');
    expect(text(camp.querySelector('p:last-of-type'))).toBe(
      'Registration openJul 5 – Jul 9, 2027 · closes Jul 1',
    );
    expect(camp.querySelector('h3 a')?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social/camps/junior-beach-volleyball-camp',
    );
    const link = harness.fixture.debugElement.queryAll(By.css('ul > li h3 a'))[0];
    expect(link.injector.get(RouterLink).state).toEqual({
      organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
      camp: { slug: 'junior-beach-volleyball-camp', name: 'Junior Beach Volleyball Camp' },
    });
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      '1 program matches “junior”',
    );
  });

  it('shows the earliest session open with room, so a full next session does not hide a later one', async () => {
    const harness = await open('/programs?q=junior');
    const [week1, week2] = JUNIOR_CAMP_ROW.sessions;
    subscription(SEARCH).emit({
      ...CAMP_SEARCH,
      rows: [{ ...JUNIOR_CAMP_ROW, sessions: [{ ...week1, placesLeft: 0 }, week2] }],
    });
    await settle(harness);
    expect(text(rows(harness)[0].querySelector('p:last-of-type'))).toBe(
      'Registration openJul 12 – Jul 16, 2027 · closes Jul 8',
    );
  });

  it('moves to the next session as the page’s clock passes, with no new answer', async () => {
    const harness = await open('/programs?q=junior');
    subscription(SEARCH).emit(CAMP_SEARCH);
    await settle(harness);
    vi.setSystemTime(at('2027-07-10'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle(harness);
    expect(text(rows(harness)[0].querySelector('p:last-of-type'))).toBe(
      'Registration closedJul 12 – Jul 16, 2027',
    );
  });

  it('drops a camp whose last session has ended at the page’s time, and shows the no-camps state', async () => {
    vi.setSystemTime(at('2027-07-17'));
    const harness = await open('/programs?type=camp');
    subscription(BROWSE).emit({
      ...browseResults([JUNIOR_CAMP_ROW]),
      typeCounts: [{ type: 'camp', count: 1 }],
    });
    await settle(harness);
    expect(rows(harness)).toEqual([]);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No camps are published yet',
    );
  });

  it('lists a camp in the browse of the camp type, by name', async () => {
    const harness = await open('/programs?type=camp&sport=beach-volleyball');
    subscription(BROWSE).emit({
      ...browseResults([JUNIOR_CAMP_ROW], {}, []),
      typeCounts: [{ type: 'camp', count: 1 }],
    });
    await settle(harness);
    expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
      'Junior Beach Volleyball Camp',
    ]);
    expect(
      host(harness).querySelector('nav[aria-label="Program type"] a[aria-current]')?.textContent,
    ).toBe('Camps');
  });

  it('offers a Camps chip when a search has a camp match, and no count on any chip', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit({
      ...MIXED,
      rows: [...MIXED.rows, JUNIOR_CAMP_ROW],
      typeCounts: [...MIXED.typeCounts, { type: 'camp', count: 1 }],
    });
    await settle(harness);
    expect(typeChips(harness)).toEqual([
      { name: 'All', href: '/programs?q=beach', current: 'page' },
      { name: 'Leagues', href: '/programs?type=league&q=beach', current: null },
      { name: 'Tournaments', href: '/programs?type=tournament&q=beach', current: null },
      { name: 'Camps', href: '/programs?type=camp&q=beach', current: null },
    ]);
  });

  it('offers a Camps chip when a browse has a camp match', async () => {
    const harness = await open('/programs?sport=beach-volleyball');
    subscription(BROWSE).emit({
      ...browseResults([JUNIOR_CAMP_ROW, SUNDAY_4S_ROW]),
      typeCounts: [
        { type: 'league', count: 1 },
        { type: 'camp', count: 1 },
      ],
    });
    await settle(harness);
    expect(typeChips(harness).map((chip) => chip.name)).toEqual(['All', 'Leagues', 'Camps']);
  });

  it('offers no Camps chip when a search or a browse has no camp match but another type', async () => {
    const harness = await open('/programs?q=beach');
    subscription(SEARCH).emit(MIXED);
    await settle(harness);
    expect(typeChips(harness).map((chip) => chip.name)).toEqual(['All', 'Leagues', 'Tournaments']);

    TestBed.resetTestingModule();
    const browse = await open('/programs?sport=soccer');
    subscription(BROWSE).emit(browseResults([SUNDAY_4S_ROW]));
    await settle(browse);
    expect(typeChips(browse).map((chip) => chip.name)).toEqual(['All', 'Leagues']);
  });

  it('says no camps match, and that a program of another type does, with a link to every type', async () => {
    const harness = await open('/programs?type=camp&q=sunday');
    subscription(SEARCH).emit({
      rows: [],
      more: false,
      facets: [],
      typeCounts: [{ type: 'league', count: 1 }],
    });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No camps match “sunday”',
    );
    expect(text(results(harness))).toContain('1 program of another type matches.');
    const all = [...results(harness)!.querySelectorAll('a')].find(
      (a) => text(a) === 'Show all types',
    );
    expect(all?.getAttribute('href')).toBe('/programs?q=sunday');
  });

  it('counts a camp on the other-types line of a league search only the camp matches', async () => {
    const harness = await open('/programs?type=league&q=junior');
    subscription(SEARCH).emit({
      rows: [],
      more: false,
      facets: [],
      typeCounts: [{ type: 'camp', count: 1 }],
    });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No leagues match “junior”',
    );
    expect(text(results(harness))).toContain('1 program of another type matches.');
  });

  it('does not count the chosen type on the other-types line when the page’s clock drops its only camp', async () => {
    vi.setSystemTime(at('2027-07-17'));
    const harness = await open('/programs?type=camp&q=junior');
    subscription(SEARCH).emit(CAMP_SEARCH);
    await settle(harness);
    expect(rows(harness)).toEqual([]);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No camps match “junior”',
    );
    expect(text(results(harness))).not.toContain('of another type');
    expect(text(results(harness))).not.toContain('of other types');
    expect(text(results(harness))).not.toContain('Show all types');
  });

  it('names camps and training programs in the intro and in the description of a link preview', async () => {
    const harness = await open('/programs');
    expect(text(host(harness).querySelector('main p'))).toBe(
      'Beach volleyball, soccer, and softball leagues, tournaments, camps, and training programs on Omni League.',
    );
    expect(head().querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe(
      'Find beach volleyball, soccer, and softball leagues, tournaments, camps, and training programs on Omni League.',
    );
  });
});

const TRAINING_SEARCH: FindResults = {
  more: false,
  rows: [SERVING_CLINIC_ROW],
  facets: [],
  typeCounts: [{ type: 'training', count: 1 }],
};

describe('Find a program training', () => {
  it('asks for training programs with withTraining, which the page of an earlier release does not send', async () => {
    const harness = await open('/programs?q=serving&type=training');
    expect(subscription(SEARCH).args).toEqual({
      q: 'serving',
      type: 'training',
      withCamps: true,
      withTraining: true,
    });
    subscription(SEARCH).emit(TRAINING_SEARCH);
    await settle(harness);
  });

  it('shows a training program with the Training badge, its pattern, where, and the series status, linking to its page', async () => {
    const harness = await open('/programs?q=serving');
    subscription(SEARCH).emit(TRAINING_SEARCH);
    await settle(harness);
    const [training] = rows(harness);
    expect(text(training.querySelector('h3'))).toBe('Tuesday Serving Clinic');
    expect(text(training.querySelector('[data-slot="badge"]'))).toBe('Training');
    expect(text(training)).toContain('Tuesdays, 6 to 7 pm, 8 weeks');
    expect(text(training)).toContain('Gulf Coast Sport & Social · North Beach Sand Courts');
    const status = training.querySelector('p:last-of-type [data-slot="badge"]');
    expect(text(status)).toBe('Registration open');
    expectBadge(status, 'secondary', 'fit');
    expect(text(training.querySelector('p:last-of-type'))).toBe(
      'Registration openJul 6 – Aug 24, 2027 · closes Jul 1',
    );
    expect(training.querySelector('h3 a')?.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social/training/tuesday-serving-clinic',
    );
    const link = harness.fixture.debugElement.queryAll(By.css('ul > li h3 a'))[0];
    expect(link.injector.get(RouterLink).state).toEqual({
      organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
      training: { slug: 'tuesday-serving-clinic', name: 'Tuesday Serving Clinic' },
    });
  });

  it('offers a Training chip beside the others when training programs match', async () => {
    const harness = await open('/programs?q=serving');
    subscription(SEARCH).emit(TRAINING_SEARCH);
    await settle(harness);
    const chips = [...host(harness).querySelectorAll('nav[aria-label="Program type"] a')].map(
      (a) => [text(a), a.getAttribute('href')],
    );
    expect(chips).toEqual([
      ['All', '/programs?q=serving'],
      ['Training', '/programs?type=training&q=serving'],
    ]);
  });

  it('drops a training program whose last class has passed at the page’s time, and shows the no-training state', async () => {
    vi.setSystemTime(at('2027-08-25'));
    const harness = await open('/programs?type=training');
    subscription(BROWSE).emit({
      ...browseResults([SERVING_CLINIC_ROW]),
      typeCounts: [{ type: 'training', count: 1 }],
    });
    await settle(harness);
    expect(rows(harness)).toEqual([]);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'No training programs are published yet',
    );
  });

  it('keeps the division filters out of the form on the training type, which they do not narrow', async () => {
    const harness = await open('/programs?type=training&gender=coed');
    subscription(BROWSE).emit({
      ...browseResults([SERVING_CLINIC_ROW], {}, []),
      typeCounts: [{ type: 'training', count: 1 }],
    });
    await settle(harness);
    expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
      'Tuesday Serving Clinic',
    ]);
    expect(
      host(harness).querySelector('[data-testid="filter-pill"], [data-slot="chip-filter"]'),
    ).toBeNull();
  });
});
