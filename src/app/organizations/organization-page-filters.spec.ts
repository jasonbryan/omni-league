import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PAGE_LOAD_WAIT_MS } from '../public-layout/page-load-wait-ms';
import { LOAD_PAGE } from '../shell/follow-link';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import { SAND, sandResults } from './testing/pages';

const LEAGUES = 'organizations:listPublicLeagues';
const LOCATIONS = 'organizations:listPublicLocations';
const OPEN_SEASONS = 'seasons:listOpenForOrganization';
const ORG = `/organizations/${SAND.slug}`;

let client: FakeConvexClient;
let loadPage: ReturnType<typeof vi.fn>;

async function open(url: string): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  loadPage = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug', component: OrganizationPage },
        { path: 'organizations/:orgSlug/sports/:sport', component: OrganizationPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
      { provide: LOAD_PAGE, useValue: loadPage },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  TestBed.tick();
  return harness;
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

function emit(results: Record<string, unknown>, names = Object.keys(results)): void {
  for (const name of names) subscription(name).emit(results[name]);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

async function shown(url: string, results: Record<string, unknown>): Promise<RouterTestingHarness> {
  const harness = await open(url);
  emit(results);
  await settle(harness);
  return harness;
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const count = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('form[aria-label="Filter leagues"] [role="status"]');
const rowNames = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('#leagues li[id] h3')].map(text);
const leaguesList = (harness: RouterTestingHarness) => host(harness).querySelector('#leagues ul');
const hrefs = (harness: RouterTestingHarness, selector: string) =>
  [...host(harness).querySelectorAll(selector)].map((a) => a.getAttribute('href'));
const link = (harness: RouterTestingHarness, name: string) =>
  [...host(harness).querySelectorAll<HTMLAnchorElement>('main a')].find((a) => text(a) === name);
const url = () => TestBed.inject(Router).url;
const click = (element: HTMLElement | undefined) =>
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  const head = TestBed.inject(DOCUMENT).head;
  for (const el of head.querySelectorAll('meta, link[rel="canonical"]')) el.remove();
});

describe('a filtered page of leagues', () => {
  it('asks for page 2 of the filtered list and keeps both formats in the page links', async () => {
    const harness = await shown(
      `${ORG}?format=4v4&format=6v6&leagues=2`,
      sandResults({ playersPerSide: [4, 6], page: 2 }),
    );
    expect(subscription(LEAGUES).args).toEqual({
      slug: SAND.slug,
      page: 2,
      playersPerSide: [4, 6],
    });
    expect(rowNames(harness)).toEqual(['Wednesday Reverse Coed 4s']);
    expect(text(count(harness))).toBe('6 of 7 leagues');
    expect(hrefs(harness, 'nav[aria-label="Leagues pages"] a')).toContain(
      `${ORG}?format=4v4&format=6v6#leagues`,
    );
    for (const href of hrefs(harness, 'ul[aria-label="Active filters"] a')) {
      expect(href).not.toContain('leagues=');
    }
  });

  it('gives the same args for a repeated, reordered format, and writes its links in canonical order', async () => {
    const harness = await shown(
      `${ORG}?format=6v6&format=4v4&format=4v4`,
      sandResults({ playersPerSide: [4, 6] }),
    );
    expect(subscription(LEAGUES).args).toEqual({
      slug: SAND.slug,
      page: 1,
      playersPerSide: [4, 6],
    });
    expect(hrefs(harness, 'nav[aria-label="Leagues pages"] a')).toContain(
      `${ORG}?format=4v4&format=6v6&leagues=2#leagues`,
    );
  });

  it('asks for no filter argument with no filter', async () => {
    await open(ORG);
    expect(subscription(LEAGUES).args).toEqual({ slug: SAND.slug, page: 1 });
    expect(subscription(OPEN_SEASONS).args).toEqual({ orgSlug: SAND.slug });
  });

  it('keeps gender=coed on the Locations page links and locations=2 on every filter change', async () => {
    const results = sandResults({ gender: ['coed'], locations: 2 });
    const harness = await shown(`${ORG}?gender=coed&locations=2`, {
      ...results,
      [LOCATIONS]: { rows: SAND.locations, page: 2, pageCount: 2, total: 6 },
    });
    expect(hrefs(harness, 'nav[aria-label="Locations pages"] a')).toContain(
      `${ORG}?gender=coed#locations`,
    );
    expect(hrefs(harness, 'ul[aria-label="Active filters"] a')).toEqual([`${ORG}?locations=2`]);
    expect(link(harness, 'Clear all')?.getAttribute('href')).toBe(`${ORG}?locations=2`);
  });
});

describe('a filter change after hydration', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await shown(
      `${ORG}?gender=coed&format=4v4`,
      sandResults({ gender: ['coed'], playersPerSide: [4] }),
    );
  });

  it('removes a pill by router navigation, holds the rows busy, and focuses the count', async () => {
    expect(rowNames(harness)).toEqual(['Monday Coed 4s', 'Wednesday Reverse Coed 4s']);
    click(link(harness, 'Gender: Coed: remove the gender filter'));
    await settle(harness);
    expect(url()).toBe(`${ORG}?format=4v4`);
    expect(loadPage).not.toHaveBeenCalled();
    expect(subscription(LEAGUES).args).toEqual({ slug: SAND.slug, page: 1, playersPerSide: [4] });
    expect(leaguesList(harness)?.getAttribute('aria-busy')).toBe('true');
    expect(rowNames(harness)).toEqual(['Monday Coed 4s', 'Wednesday Reverse Coed 4s']);
    expect(document.activeElement).toBe(count(harness));
    expect(text(count(harness))).toBe('');

    emit(sandResults({ playersPerSide: [4] }), [LEAGUES]);
    await settle(harness);
    expect(leaguesList(harness)?.getAttribute('aria-busy')).toBeNull();
    expect(text(count(harness))).toBe('3 of 7 leagues');
  });

  it('clears every filter by router navigation and focuses the count', async () => {
    click(link(harness, 'Clear all'));
    await settle(harness);
    expect(url()).toBe(ORG);
    expect(loadPage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(count(harness));
    expect(text(count(harness))).toBe('7 leagues');
  });

  it('starts the page-load wait over when only a filter changes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await harness.navigateByUrl(`${ORG}?gender=womens`);
    await settle(harness);
    vi.advanceTimersByTime(PAGE_LOAD_WAIT_MS - 1_000);
    await settle(harness);
    await harness.navigateByUrl(`${ORG}?gender=mens`);
    await settle(harness);
    vi.advanceTimersByTime(PAGE_LOAD_WAIT_MS - 1);
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).toBeNull();
    vi.advanceTimersByTime(1);
    await settle(harness);
    expect(link(harness, 'Try again')?.getAttribute('href')).toBe(`${ORG}?gender=mens`);
  });
});

describe('the no-matches state', () => {
  it('shows the heading, the hint, and Clear all, with no Registration open or Register link', async () => {
    const harness = await shown(
      `${ORG}?gender=mens&format=6v6`,
      sandResults({ gender: ['mens'], playersPerSide: [6] }),
    );
    const leagues = host(harness).querySelector('#leagues');
    expect(text(leagues)).toContain('No leagues match these filters');
    expect(link(harness, 'Register for a season')).toBeUndefined();
    expect(host(harness).querySelector('#registration-open')).toBeNull();
    expect(leagues?.parentElement?.classList.contains('border-t')).toBe(false);
    const clear = [...(leagues?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].find(
      (a) => text(a) === 'Clear all',
    );
    click(clear);
    await settle(harness);
    expect(url()).toBe(ORG);
    expect(document.activeElement).toBe(count(harness));
  });
});
