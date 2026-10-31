import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PAGE_LOAD_WAIT_MS } from '../public-layout/page-load-wait-ms';
import { PAGE_STALLED_ANNOUNCEMENT } from '../public-layout/page-load-status';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import { GULF_COAST, PAGED, PORT_ARANSAS, pagedResults, queryResults } from './testing/pages';
import type { PublicOrganizationPage } from './organization-path';

const PATH = `/organizations/${GULF_COAST.slug}`;

let client: FakeConvexClient;

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function open(url = PATH): Promise<RouterTestingHarness> {
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

async function elapse(harness: RouterTestingHarness, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await settle(harness);
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function answer(
  harness: RouterTestingHarness,
  page: PublicOrganizationPage = GULF_COAST,
): Promise<void> {
  for (const [name, value] of Object.entries(queryResults(page))) subscription(name).emit(value);
  await settle(harness);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const skeleton = (harness: RouterTestingHarness) =>
  host(harness).querySelector('app-organization-skeleton');
const errorView = (harness: RouterTestingHarness) =>
  host(harness).querySelector('app-server-error-view');
const announcement = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main app-page-load-status [role="status"]');

describe('OrganizationPage when no query answers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows the unavailable view with Try again to its own path once the wait has passed, and drops the skeleton', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(errorView(harness)).toBeNull();

    await elapse(harness, 1);
    expect(skeleton(harness)).toBeNull();
    expect(text(errorView(harness)?.querySelector('h1'))).toBe(
      'This page is temporarily unavailable',
    );
    expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(PATH);
    expect(TestBed.inject(Title).getTitle()).toBe('Temporarily unavailable | Omni League');
  });

  it('leaves no page-loading mark in the layout, so the footer shows', async () => {
    const harness = await open();
    expect(host(harness).querySelector('[data-page-loading]')).not.toBeNull();

    await elapse(harness, PAGE_LOAD_WAIT_MS);
    expect(host(harness).querySelector('[data-page-loading]')).toBeNull();
    expect(host(harness).querySelector('footer')).not.toBeNull();
  });

  it('shows the page when the held answer arrives after the error view', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS);
    expect(errorView(harness)).not.toBeNull();

    await answer(harness);
    expect(errorView(harness)).toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
    expect(TestBed.inject(Title).getTitle()).toBe(`${GULF_COAST.name} | Omni League`);
  });

  it('never shows the error view when the answer arrives before the wait ends', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    await answer(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);

    await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
    expect(errorView(harness)).toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
  });

  it('starts the wait over when the visitor navigates to another organization', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1_000);
    await harness.navigateByUrl(`/organizations/${PORT_ARANSAS.slug}`);
    await settle(harness);

    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(errorView(harness)).toBeNull();

    await elapse(harness, 1);
    expect(errorView(harness)).not.toBeNull();
    expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(
      `/organizations/${PORT_ARANSAS.slug}`,
    );
  });

  it('starts the wait over when the visitor moves to another sport view of the same organization', async () => {
    const harness = await open(`${PATH}/sports/soccer`);
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1_000);
    await harness.navigateByUrl(`${PATH}/sports/softball`);
    await settle(harness);

    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(errorView(harness)).toBeNull();

    await elapse(harness, 1);
    expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(
      `${PATH}/sports/softball`,
    );
  });

  describe('offline', () => {
    it('shows the not-saved view with no saved copy, and the wait does not run', async () => {
      stubOnLine(false);
      const harness = await open();
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();

      await elapse(harness, PAGE_LOAD_WAIT_MS * 3);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(errorView(harness)).toBeNull();
    });

    it('replaces the error view with the not-saved view, then starts the wait over when back online', async () => {
      const harness = await open();
      await elapse(harness, PAGE_LOAD_WAIT_MS);
      expect(errorView(harness)).not.toBeNull();

      stubOnLine(false);
      await settle(harness);
      expect(errorView(harness)).toBeNull();
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
      expect(errorView(harness)).toBeNull();

      stubOnLine(true);
      await settle(harness);
      expect(skeleton(harness)).not.toBeNull();
      expect(errorView(harness)).toBeNull();
      await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
      expect(skeleton(harness)).not.toBeNull();
      expect(errorView(harness)).toBeNull();

      await elapse(harness, 1);
      expect(errorView(harness)).not.toBeNull();
    });
  });

  describe('announcement', () => {
    it('fills a status region that was already empty in the page, and leaves focus where it was', async () => {
      const harness = await open();
      const region = announcement(harness);
      expect(region).not.toBeNull();
      expect(region?.textContent).toBe('');
      const focused = document.activeElement;

      await elapse(harness, PAGE_LOAD_WAIT_MS);
      expect(errorView(harness)).not.toBeNull();
      expect(announcement(harness)).toBe(region);
      expect(region?.textContent).toBe(PAGE_STALLED_ANNOUNCEMENT);
      expect(document.activeElement).toBe(focused);
    });

    it('empties the region when the held answer arrives', async () => {
      const harness = await open();
      const region = announcement(harness);
      await elapse(harness, PAGE_LOAD_WAIT_MS);

      await answer(harness);
      expect(announcement(harness)).toBe(region);
      expect(region?.textContent).toBe('');
    });
  });
});

describe('OrganizationPage when a new page never answers', () => {
  const ORG = `/organizations/${PAGED.slug}`;
  const SOCCER = `${ORG}/sports/soccer`;
  const LEAGUES = 'organizations:listPublicLeagues';
  const LOCATIONS = 'organizations:listPublicLocations';

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  async function shown(url: string, segment?: string): Promise<RouterTestingHarness> {
    const harness = await open(url);
    for (const [name, value] of Object.entries(pagedResults(PAGED, {}, segment))) {
      subscription(name).emit(value);
    }
    await settle(harness);
    return harness;
  }

  function activate(harness: RouterTestingHarness, label: string): void {
    const link = host(harness).querySelector<HTMLAnchorElement>(
      `nav[aria-label="${label}"] a[href*="=2#"]`,
    );
    expect(link, label).not.toBeNull();
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  }

  const busyList = (harness: RouterTestingHarness) =>
    host(harness).querySelector('main ul[aria-busy="true"]');

  it.each([
    ['Leagues pages', LEAGUES, `${ORG}?leagues=2`, undefined],
    ['Locations pages', LOCATIONS, `${ORG}?locations=2`, undefined],
    ['Leagues pages', LEAGUES, `${SOCCER}?page=2`, 'soccer'],
    ['Locations pages', LOCATIONS, `${SOCCER}?locations=2`, 'soccer'],
  ])(
    'after %s on %s held for the wait, shows the error view with Try again to %s, announced, with focus on its h1 and then on main when the page arrives',
    async (label, name, retry, segment) => {
      const harness = await shown(segment ? SOCCER : ORG, segment);
      const region = announcement(harness);
      activate(harness, label);
      await settle(harness);
      expect(busyList(harness)).not.toBeNull();

      await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
      expect(errorView(harness)).toBeNull();
      expect(busyList(harness)).not.toBeNull();

      await elapse(harness, 1);
      expect(text(errorView(harness)?.querySelector('h1'))).toBe(
        'This page is temporarily unavailable',
      );
      expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(retry);
      expect(host(harness).querySelector('main ul')).toBeNull();
      expect(announcement(harness)).toBe(region);
      expect(region?.textContent).toBe(PAGE_STALLED_ANNOUNCEMENT);
      expect(document.activeElement).toBe(errorView(harness)?.querySelector('h1'));
      expect(TestBed.inject(Title).getTitle()).toBe('Temporarily unavailable | Omni League');

      const page = name === LEAGUES ? { leagues: 2 } : { locations: 2 };
      subscription(name).emit(pagedResults(PAGED, page, segment)[name]);
      await settle(harness);
      expect(errorView(harness)).toBeNull();
      expect(region?.textContent).toBe('');
      const section = name === LEAGUES ? '#leagues' : '#locations';
      const first = name === LEAGUES ? 'league-6' : 'location-6';
      expect(host(harness).querySelector(`${section} li[id]`)?.id).toBe(first);
      expect(document.activeElement).toBe(host(harness).querySelector('main#main'));
    },
  );

  it('never shows the error view when the new page answers before the wait ends', async () => {
    const harness = await shown(ORG);
    activate(harness, 'Leagues pages');
    await settle(harness);
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    subscription(LEAGUES).emit(pagedResults(PAGED, { leagues: 2 })[LEAGUES]);
    await settle(harness);
    await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
    expect(errorView(harness)).toBeNull();
    expect(host(harness).querySelector('#leagues li[id]')?.id).toBe('league-6');
  });

  it('starts the wait over when a second page change comes during the hold', async () => {
    const harness = await shown(ORG);
    activate(harness, 'Leagues pages');
    await settle(harness);
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1_000);
    await harness.navigateByUrl(`${ORG}?leagues=3`);
    await settle(harness);
    expect(busyList(harness)).not.toBeNull();

    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(errorView(harness)).toBeNull();
    await elapse(harness, 1);
    expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(`${ORG}?leagues=3`);
  });
});
