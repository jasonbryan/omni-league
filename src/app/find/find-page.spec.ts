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
  manyResults,
  NO_RESULTS,
  OPEN_DAY,
  SATURDAY_6S_ROW,
  SUNDAY_4S_ROW,
} from './testing/find-data';

const QUERY = 'search:leagues';

let client: FakeConvexClient;

async function open(url = '/leagues'): Promise<RouterTestingHarness> {
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

function subscription(): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === QUERY);
  expect(active).toHaveLength(1);
  return active[0];
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const head = () => TestBed.inject(DOCUMENT).head;
const robots = () => head().querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const input = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLInputElement>('main input[name="q"]')!;
const results = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main section[aria-labelledby="results-heading"]');

async function search(harness: RouterTestingHarness, q: string): Promise<void> {
  const field = input(harness);
  field.value = q;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  host(harness).querySelector<HTMLButtonElement>('main form button[type="submit"]')!.click();
  await settle(harness);
}

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

describe('FindPage before a search', () => {
  it('shows the heading, the intro, and the search form, and asks no query', async () => {
    const harness = await open();
    const main = host(harness).querySelector('main')!;
    expect(text(main.querySelector('h1'))).toBe('Find a league');
    expect(text(main.querySelector('h1 + p'))).toBe(
      'Beach volleyball, soccer, and softball leagues on Omni League.',
    );
    const form = main.querySelector('form')!;
    expect(form.getAttribute('role')).toBe('search');
    expect(form.getAttribute('action')).toBe('/leagues');
    expect(form.getAttribute('method')).toBe('get');
    expect(text(form.querySelector('label[for="find-q"]'))).toBe(
      'League, organization, or location',
    );
    expect(input(harness).value).toBe('');
    expect(text(form.querySelector('button[type="submit"]'))).toBe('Search');
    expect(results(harness)).toBeNull();
    expect(client.activeSubscriptions.filter((s) => s.name === QUERY)).toEqual([]);
  });

  it('sets the title, the canonical, and no robots tag', async () => {
    await open();
    expect(TestBed.inject(Title).getTitle()).toBe('Find a league | Omni League');
    expect(canonical()).toBe(`${location.origin}/leagues`);
    expect(robots()).toBeNull();
  });

  it('treats a blank q as no search', async () => {
    const harness = await open('/leagues?q=%20%20');
    expect(results(harness)).toBeNull();
    expect(client.activeSubscriptions.filter((s) => s.name === QUERY)).toEqual([]);
  });
});

describe('FindPage query', () => {
  it('asks the parsed q only, and keeps it in the field', async () => {
    const harness = await open('/leagues?q=%20north%20%20beach%20&utm_source=x&ott=SECRET');
    expect(subscription().args).toEqual({ q: 'north beach' });
    expect(input(harness).value).toBe('north beach');
  });

  it('uses the first value of a repeated q', async () => {
    await open('/leagues?q=a&q=b');
    expect(subscription().args).toEqual({ q: 'a' });
  });

  it('cuts q to 100 characters and 16 words', async () => {
    await open(`/leagues?q=${'x'.repeat(300)}`);
    expect(subscription().args).toEqual({ q: 'x'.repeat(100) });
    TestBed.resetTestingModule();
    const words = Array.from({ length: 20 }, (_, i) => `w${i + 1}`);
    await open(`/leagues?q=${words.join('+')}`);
    expect(subscription().args).toEqual({ q: words.slice(0, 16).join(' ') });
  });
});

describe('FindPage results', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open('/leagues?q=coed');
    subscription().emit(COED_RESULTS);
    await settle(harness);
  });

  it('shows the count line as a status and a row per league in the order given', () => {
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe('3 leagues match “coed”');
    expect([...results(harness)!.querySelectorAll('ul > li h3')].map(text)).toEqual([
      'Sunday Reverse Coed 4s',
      'Thursday Night Coed 2s',
      'Saturday Coed 6s',
    ]);
  });

  it('shows each row with its mark, link, division, organization and locations, and season status', () => {
    const [sunday, , saturday] = [...results(harness)!.querySelectorAll('ul > li')];
    expect(text(sunday.querySelector('[aria-hidden="true"]'))).toBe('GC');
    const link = sunday.querySelector('h3 a')!;
    expect(link.getAttribute('href')).toBe(
      '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s',
    );
    expect(text(sunday)).toContain('Coed · 4v4 · BB');
    expect(text(sunday)).toContain('Gulf Coast Sport & Social · North Beach Sand Courts');
    expect(text(sunday.querySelector('[data-slot="badge"]'))).toBe('Registration open');
    expect(text(sunday)).toContain('Summer 2027 · closes May 23');

    expect(text(saturday)).toContain(
      'Lakeshore Sand League · Driftwood Beach Courts, Harbor Point Sand Courts',
    );
    expect(text(saturday)).toContain('No upcoming season');
    expect(saturday.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('shows the organization logo in the mark of a row whose organization has one, and the initials for the others', async () => {
    const logoUrl = 'https://example.convex.cloud/api/storage/gulf-logo';
    subscription().emit({
      more: false,
      rows: [
        { ...SUNDAY_4S_ROW, organization: { ...SUNDAY_4S_ROW.organization, logoUrl } },
        SATURDAY_6S_ROW,
      ],
    });
    await settle(harness);
    const [sunday, saturday] = [...results(harness)!.querySelectorAll('ul > li')];
    const image = sunday.querySelector('app-organization-mark img');
    expect(image?.getAttribute('src')).toBe(logoUrl);
    expect(image?.getAttribute('alt')).toBe('');
    expect(text(sunday.querySelector('app-organization-mark'))).toBe('');
    expect(saturday.querySelector('app-organization-mark img')).toBeNull();
    expect(text(saturday.querySelector('app-organization-mark'))).toBe('LS');
  });

  it('marks the view noindex with the canonical /leagues and a title naming the search', () => {
    expect(robots()).toBe('noindex');
    expect(canonical()).toBe(`${location.origin}/leagues`);
    expect(TestBed.inject(Title).getTitle()).toBe('coed | Find a league | Omni League');
  });

  it('says "1 league matches" for one row', async () => {
    subscription().emit({ more: false, rows: [SATURDAY_6S_ROW] });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      '1 league matches “coed”',
    );
  });

  it('says there are more than 50 and to add a word', async () => {
    subscription().emit(manyResults(50, true));
    await settle(harness);
    expect(results(harness)!.querySelectorAll('ul > li')).toHaveLength(50);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      'Showing the first 50. Add a word to narrow the search.',
    );
  });

  it('follows the live result', async () => {
    subscription().emit({ more: false, rows: [SUNDAY_4S_ROW] });
    await settle(harness);
    expect(results(harness)!.querySelectorAll('ul > li')).toHaveLength(1);
  });
});

describe('FindPage with no results', () => {
  it('says no leagues match, suggests other words, and links Clear the search to /leagues', async () => {
    const harness = await open('/leagues?q=pickleball');
    subscription().emit(NO_RESULTS);
    await settle(harness);
    const section = results(harness)!;
    expect(text(section.querySelector('[role="status"]'))).toBe('No leagues match “pickleball”');
    expect(text(section)).toContain(
      'Omni League has beach volleyball, soccer, and softball leagues. Try a league name, an organization, or a location such as “North Beach”.',
    );
    expect(section.querySelector('ul')).toBeNull();
    const clear = section.querySelector('a')!;
    expect(text(clear)).toBe('Clear the search');
    expect(clear.getAttribute('href')).toBe('/leagues');
    expect(robots()).toBe('noindex');
  });
});

describe('FindPage suggestions', () => {
  it('lists each suggested search as a link, in order, in a list labelled by "Try fewer words:", before "Clear the search"', async () => {
    const harness = await open('/leagues?q=coed%204s%20austin');
    subscription().emit({ more: false, rows: [], suggestions: ['coed 4s', 'coed austin'] });
    await settle(harness);
    const section = results(harness)!;
    const label = [...section.querySelectorAll('p')].find((p) => text(p) === 'Try fewer words:')!;
    expect(label).toBeDefined();
    const list = section.querySelector('ul')!;
    expect(list.getAttribute('aria-labelledby')).toBe(label.id);
    expect(
      [...list.querySelectorAll('li a')].map((a) => [text(a), a.getAttribute('href')]),
    ).toEqual([
      ['coed 4s', '/leagues?q=coed%204s'],
      ['coed austin', '/leagues?q=coed%20austin'],
    ]);
    const clear = [...section.querySelectorAll('a')].find((a) => text(a) === 'Clear the search')!;
    expect(list.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(section.querySelector('[role="status"]'))).toBe(
      'No leagues match “coed 4s austin”',
    );
  });

  it('follows a suggestion to its search', async () => {
    const harness = await open('/leagues?q=coed%204s%20austin');
    subscription().emit({ more: false, rows: [], suggestions: ['coed 4s'] });
    await settle(harness);
    results(harness)!.querySelector<HTMLAnchorElement>('ul a')!.click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/leagues?q=coed%204s');
    expect(subscription().args).toEqual({ q: 'coed 4s' });
    expect(input(harness).value).toBe('coed 4s');
  });

  it('moves focus to the status line of the new results once they arrive, not before', async () => {
    const harness = await open('/leagues?q=coed%204s%20austin');
    subscription().emit({ more: false, rows: [], suggestions: ['coed 4s'] });
    await settle(harness);
    const link = results(harness)!.querySelector<HTMLAnchorElement>('ul a')!;
    link.focus();
    link.click();
    await settle(harness);
    expect(results(harness)!.querySelector('[data-testid="find-skeleton"]')).not.toBeNull();
    expect(host(harness).ownerDocument.activeElement).not.toBe(
      results(harness)!.querySelector('[role="status"]'),
    );

    subscription().emit({ more: false, rows: [SUNDAY_4S_ROW] });
    await settle(harness);
    const status = results(harness)!.querySelector('[role="status"]');
    expect(text(status)).toBe('1 league matches “coed 4s”');
    expect(host(harness).ownerDocument.activeElement).toBe(status);
  });

  it('moves focus to the search field when Clear the search is followed', async () => {
    const harness = await open('/leagues?q=pickleball');
    subscription().emit(NO_RESULTS);
    await settle(harness);
    const clear = [...results(harness)!.querySelectorAll('a')].find(
      (a) => text(a) === 'Clear the search',
    )!;
    clear.focus();
    clear.click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/leagues');
    expect(host(harness).ownerDocument.activeElement).toBe(input(harness));
  });

  it('leaves focus alone when a suggestion is opened in a new tab', async () => {
    const harness = await open('/leagues?q=coed%204s%20austin');
    subscription().emit({ more: false, rows: [], suggestions: ['coed 4s'] });
    await settle(harness);
    const link = results(harness)!.querySelector<HTMLAnchorElement>('ul a')!;
    link.focus();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    await search(harness, 'coed');
    subscription().emit(COED_RESULTS);
    await settle(harness);
    expect(host(harness).ownerDocument.activeElement).not.toBe(
      results(harness)!.querySelector('[role="status"]'),
    );
  });

  it('shows no list when there are no suggestions', async () => {
    const harness = await open('/leagues?q=pickleball');
    subscription().emit(NO_RESULTS);
    await settle(harness);
    expect(text(results(harness))).not.toContain('Try fewer words');
    expect(results(harness)!.querySelector('ul')).toBeNull();
  });

  it('shows no list when there are results', async () => {
    const harness = await open('/leagues?q=coed');
    subscription().emit(COED_RESULTS);
    await settle(harness);
    expect(text(results(harness))).not.toContain('Try fewer words');
  });
});

describe('FindPage searching', () => {
  it('shows skeleton rows with a Searching status until the results arrive', async () => {
    const harness = await open('/leagues?q=coed');
    const skeleton = results(harness)!.querySelector('[data-testid="find-skeleton"]');
    expect(skeleton).not.toBeNull();
    const status = skeleton!.querySelector('[role="status"]')!;
    expect(text(status)).toBe('Searching.');
    expect(status.className).toContain('sr-only');
    expect(skeleton!.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(5);
    expect(skeleton!.querySelector('a, h3')).toBeNull();

    subscription().emit(COED_RESULTS);
    await settle(harness);
    expect(results(harness)!.querySelector('[data-testid="find-skeleton"]')).toBeNull();
  });

  it('a new search from the form changes the URL, shows the skeleton, then its results', async () => {
    const harness = await open('/leagues?q=coed');
    subscription().emit(COED_RESULTS);
    await settle(harness);

    await search(harness, '  north   beach ');
    expect(TestBed.inject(Router).url).toBe('/leagues?q=north%20beach');
    expect(subscription().args).toEqual({ q: 'north beach' });
    expect(results(harness)!.querySelector('[data-testid="find-skeleton"]')).not.toBeNull();
    expect(results(harness)!.querySelector('ul')).toBeNull();

    subscription().emit({ more: false, rows: [SUNDAY_4S_ROW] });
    await settle(harness);
    expect(text(results(harness)!.querySelector('[role="status"]'))).toBe(
      '1 league matches “north beach”',
    );
  });

  it('an empty search goes to /leagues and shows the form only', async () => {
    const harness = await open('/leagues?q=coed');
    subscription().emit(COED_RESULTS);
    await settle(harness);
    await search(harness, '   ');
    expect(TestBed.inject(Router).url).toBe('/leagues');
    expect(results(harness)).toBeNull();
    expect(robots()).toBeNull();
    expect(client.activeSubscriptions.filter((s) => s.name === QUERY)).toEqual([]);
  });

  it('Back shows the earlier search in the field and its results', async () => {
    const harness = await open('/leagues?q=coed');
    subscription().emit(COED_RESULTS);
    await settle(harness);
    await search(harness, 'north beach');
    subscription().emit({ more: false, rows: [SUNDAY_4S_ROW] });
    await settle(harness);

    await TestBed.inject(Router).navigateByUrl('/leagues?q=coed');
    await settle(harness);
    expect(input(harness).value).toBe('coed');
    expect(subscription().args).toEqual({ q: 'coed' });
  });
});

describe('FindPage when the search fails', () => {
  it('replaces the results with an alert with Try again, keeps the form usable, and a new search recovers', async () => {
    const harness = await open('/leagues?q=coed');
    subscription().fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
    await settle(harness);

    const main = host(harness).querySelector('main')!;
    const alert = main.querySelector('[role="alert"]')!;
    expect(text(alert)).toContain('The search could not be completed.');
    const retry = alert.querySelector('a')!;
    expect(text(retry)).toBe('Try again');
    expect(retry.getAttribute('href')).toBe('/leagues?q=coed');
    expect(text(main)).not.toContain('internal-db');
    expect(main.querySelector('ul')).toBeNull();
    expect(main.querySelector('h1')?.textContent).toContain('Find a league');
    expect(input(harness).value).toBe('coed');

    await search(harness, 'soccer');
    subscription().emit({ more: false, rows: [SUNDAY_4S_ROW] });
    await settle(harness);
    expect(main.querySelector('[role="alert"]')).toBeNull();
    expect(results(harness)!.querySelectorAll('ul > li')).toHaveLength(1);
  });
});

describe('FindPage layout', () => {
  it('sits in the public layout, whose footer links to /leagues', async () => {
    const harness = await open();
    const footerLinks = [...host(harness).querySelectorAll('footer nav a')].map((a) => [
      text(a),
      a.getAttribute('href'),
    ]);
    expect(footerLinks[0]).toEqual(['Find a league', '/leagues']);
    expect(host(harness).querySelector('main#main[tabindex="-1"]')).not.toBeNull();
  });
});
