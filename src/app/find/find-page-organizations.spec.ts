import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { FindPage } from './find-page';
import { COED_RESULTS } from './testing/find-data';
import { NO_ORGANIZATIONS, ORGANIZATIONS, organizationsPage } from './testing/organizations-data';

const ORGANIZATIONS_QUERY = 'search:organizations';

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

function subscription(name = ORGANIZATIONS_QUERY): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function emit(harness: RouterTestingHarness, value: unknown): Promise<void> {
  subscription().emit(value);
  await settle(harness);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const head = () => TestBed.inject(DOCUMENT).head;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const section = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('main section[aria-labelledby="organizations-heading"]');
const heading = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('#organizations-heading');
const control = (harness: RouterTestingHarness) =>
  host(harness).querySelector('nav[aria-label="Organizations pages"]');

afterEach(() => {
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('FindPage organizations: the query', () => {
  it('asks page 1 of the organizations and no search before a search', async () => {
    await open();
    expect(client.activeSubscriptions.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: ORGANIZATIONS_QUERY, args: { page: 1 } },
    ]);
  });

  it('reads the page from the page parameter alone', async () => {
    await open('/leagues?page=2&ott=SECRET&utm_source=x');
    expect(subscription().args).toEqual({ page: 2 });
  });

  it.each(['?page=0', '?page=abc', '?page=2&page=3', '?page=-1', '?page=1000'])(
    'asks page 1 for %s',
    async (query) => {
      await open(`/leagues${query}`);
      expect(subscription().args).toEqual({ page: 1 });
    },
  );

  it('asks the search alone, and shows no organizations, when q is set', async () => {
    const harness = await open('/leagues?q=coed&page=2');
    expect(client.activeSubscriptions.map((s) => s.name)).toEqual(['search:leagues']);
    subscription('search:leagues').emit(COED_RESULTS);
    await settle(harness);
    expect(section(harness)).toBeNull();
  });
});

describe('FindPage organizations: the list', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    await emit(harness, ORGANIZATIONS);
  });

  it('titles the list "Organizations", under the form', () => {
    const main = host(harness).querySelector('main')!;
    expect(text(heading(harness))).toBe('Organizations');
    expect(
      main.querySelector('form')!.compareDocumentPosition(section(harness)!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('lists each organization with its mark, a link to its page, its sports, and City, state', () => {
    const rows = [...section(harness)!.querySelectorAll('ul > li')];
    expect(rows.map((row) => text(row.querySelector('h3')))).toEqual([
      'Front Range Rec Sports',
      'Gulf Coast Sport & Social',
      'Saguaro Valley Softball',
    ]);
    expect(rows.map((row) => row.querySelector('h3 a')?.getAttribute('href'))).toEqual([
      '/organizations/front-range-rec-sports',
      '/organizations/gulf-coast-sport-social',
      '/organizations/saguaro-valley-softball',
    ]);
    expect(rows.map((row) => text(row.querySelector('p')))).toEqual([
      'Soccer, softball · Denver, CO',
      'Beach volleyball, soccer, softball · Corpus Christi, TX',
      'Softball',
    ]);
    expect(rows.map((row) => text(row.querySelector('[aria-hidden="true"]')))).toEqual([
      'FR',
      'GC',
      'SV',
    ]);
  });

  it('shows no page control for one page', () => {
    expect(control(harness)).toBeNull();
  });

  it('sets the canonical to /leagues', () => {
    expect(canonical()).toBe(`${location.origin}/leagues`);
  });

  it('keeps the form usable beside the list', () => {
    expect(host(harness).querySelector('main form[role="search"] input[name="q"]')).not.toBeNull();
  });
});

describe('FindPage organizations: pages', () => {
  it('shows the page control with plain links, and the canonical of page 2 carries ?page=2', async () => {
    const harness = await open('/leagues?page=2');
    await emit(harness, organizationsPage(2));
    expect([...section(harness)!.querySelectorAll('ul > li h3')].map((h3) => text(h3))).toEqual([
      'Club 6',
      'Club 7',
    ]);
    const links = [...control(harness)!.querySelectorAll('a')].map((a) => [
      text(a),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Previous page', '/leagues'],
      ['Page 1', '/leagues'],
      ['Page 2', '/leagues?page=2'],
    ]);
    expect(text(control(harness)!.querySelector('p'))).toBe('6–7 of 7 organizations');
    expect(canonical()).toBe(`${location.origin}/leagues?page=2`);
  });

  it('shows page 1 of the query result for a page that is out of range', async () => {
    const harness = await open('/leagues?page=9');
    await emit(harness, organizationsPage(1));
    expect(canonical()).toBe(`${location.origin}/leagues`);
  });

  it('follows Next through the router with a history entry, holds the shown page busy, then moves focus to the heading', async () => {
    const harness = await open();
    await emit(harness, organizationsPage(1));
    const next = [...control(harness)!.querySelectorAll('a')].find((a) => text(a) === 'Next page')!;
    next.click();
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/leagues?page=2');
    expect(subscription().args).toEqual({ page: 2 });
    expect(section(harness)!.querySelector('ul')!.getAttribute('aria-busy')).toBe('true');
    expect(
      [...section(harness)!.querySelectorAll('ul > li h3')].map((h3) => text(h3)),
    ).toHaveLength(5);

    await emit(harness, organizationsPage(2));
    expect(section(harness)!.querySelector('ul')!.getAttribute('aria-busy')).toBeNull();
    expect([...section(harness)!.querySelectorAll('ul > li h3')].map((h3) => text(h3))).toEqual([
      'Club 6',
      'Club 7',
    ]);
    expect(host(harness).ownerDocument.activeElement).toBe(heading(harness));
  });

  it('does not move focus when the shown page updates live', async () => {
    const harness = await open();
    await emit(harness, organizationsPage(1));
    await emit(harness, organizationsPage(1));
    expect(host(harness).ownerDocument.activeElement).not.toBe(heading(harness));
  });
});

describe('FindPage organizations: states', () => {
  it('shows skeleton rows with the status "Loading organizations." until the data arrives', async () => {
    const harness = await open();
    expect(text(section(harness)!.querySelector('[role="status"]'))).toBe('Loading organizations.');
    expect(section(harness)!.querySelector('[role="status"]')!.className).toContain('sr-only');
    expect(
      section(harness)!.querySelectorAll('[aria-hidden="true"][class*="animate-pulse"]').length,
    ).toBeGreaterThan(0);
    expect(section(harness)!.querySelector('ul')).toBeNull();
    expect(control(harness)).toBeNull();

    await emit(harness, ORGANIZATIONS);
    expect(section(harness)!.querySelector('[role="status"]')).toBeNull();
    expect(section(harness)!.querySelectorAll('ul > li')).toHaveLength(3);
  });

  it('says no organization has published a league yet, with no page control', async () => {
    const harness = await open();
    await emit(harness, NO_ORGANIZATIONS);
    expect(text(section(harness))).toContain('No organizations have published a league yet.');
    expect(section(harness)!.querySelector('ul')).toBeNull();
    expect(control(harness)).toBeNull();
  });

  it('replaces the list with an alert and a Try again link when the query fails, and the form stays usable', async () => {
    const harness = await open('/leagues?page=2');
    subscription().fail(new Error('boom'));
    await settle(harness);

    const alert = section(harness)!.querySelector('[role="alert"]')!;
    expect(text(alert)).toContain('The organizations could not be loaded.');
    const retry = [...alert.querySelectorAll('a')].find((a) => text(a) === 'Try again')!;
    expect(retry.getAttribute('href')).toBe('/leagues?page=2');
    expect(section(harness)!.querySelector('ul')).toBeNull();
    expect(control(harness)).toBeNull();
    const field = host(harness).querySelector<HTMLInputElement>('main form input[name="q"]')!;
    expect(field.disabled).toBe(false);
    expect(host(harness).querySelector('app-server-error-view')).toBeNull();
  });
});
