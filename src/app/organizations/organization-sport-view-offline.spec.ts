import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { api } from '../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../core/data/convex/testing/saved-copy';
import { formatSavedTime } from '../offline/saved-time';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import { GULF_COAST, sportQueryResults } from './testing/pages';

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);
const ORG = '/organizations/gulf-coast-sport-social';
const SLUG = GULF_COAST.slug;

const HEADER = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';
const LOCATIONS = 'organizations:listPublicLocations';

function plant(sport: 'soccer' | 'softball', options: { leagues?: boolean } = {}): void {
  const results = sportQueryResults(GULF_COAST, sport === 'soccer' ? 'soccer' : 'softball');
  plantSavedCopy(api.organizations.getPublicPage, { slug: SLUG }, results[HEADER], SAVED_AT);
  if (options.leagues !== false) {
    plantSavedCopy(
      api.organizations.listPublicLeagues,
      { slug: SLUG, page: 1, sport },
      results[LEAGUES],
      SAVED_AT,
    );
  }
  plantSavedCopy(
    api.organizations.listPublicLocations,
    { slug: SLUG, page: 1, sport },
    results[LOCATIONS],
    SAVED_AT,
  );
}

async function open(url: string): Promise<RouterTestingHarness> {
  const client = new FakeConvexClient();
  client.setConnected(false, { neverConnected: true });
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

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the sport view offline', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows the saved sport, its chips, and the saved-copy note', async () => {
    plant('soccer');
    const harness = await open(`${ORG}/sports/soccer`);
    const main = host(harness).querySelector('main');
    expect(text(main?.querySelector('#leagues-heading'))).toBe('Soccer leagues');
    expect([...(main?.querySelectorAll('#leagues h3') ?? [])].map(text)).toEqual([
      'Coed 7v7 Rec',
      "Men's Over-30 11v11",
    ]);
    expect([...(main?.querySelectorAll('#locations h3') ?? [])].map(text)).toEqual([
      'Bayside Athletic Complex',
    ]);
    expect(text(main?.querySelector('nav[aria-label="Sports"] [aria-current="page"]'))).toContain(
      'Soccer',
    );
    expect(text(main?.querySelector('[data-saved-copy-note]'))).toBe(
      `Saved copy from ${formatSavedTime(SAVED_AT, NOW).text}. It may have changed since.`,
    );
  });

  it('shows the not-saved view, with Try again to the sport view, when the sport has no saved leagues', async () => {
    plant('soccer', { leagues: false });
    const harness = await open(`${ORG}/sports/soccer?ott=SECRET`);
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe(
      "This page isn't saved on this device",
    );
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(
      `${ORG}/sports/soccer`,
    );
  });

  it('shows the not-saved view for a page of the sport that was never saved', async () => {
    plant('soccer');
    const harness = await open(`${ORG}/sports/soccer?page=2`);
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(host(harness).querySelector('#leagues')).toBeNull();
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(
      `${ORG}/sports/soccer?page=2`,
    );
  });

  it('keeps no rows of the first sport when the visitor goes on to a sport that was not saved', async () => {
    plant('soccer');
    const harness = await open(`${ORG}/sports/soccer`);
    expect(host(harness).querySelector('#leagues')).not.toBeNull();
    await TestBed.inject(Router).navigateByUrl(`${ORG}/sports/softball`);
    await settle(harness);
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(host(harness).textContent).not.toContain('Coed 7v7 Rec');
  });

  it('shows the saved sport after a chip to another saved sport', async () => {
    plant('soccer');
    plant('softball');
    const harness = await open(`${ORG}/sports/soccer`);
    await TestBed.inject(Router).navigateByUrl(`${ORG}/sports/softball`);
    await settle(harness);
    expect(text(host(harness).querySelector('#leagues-heading'))).toBe('Softball leagues');
    expect([...host(harness).querySelectorAll('#leagues h3')].map(text)).toEqual([
      'Wednesday Coed Slow-Pitch',
    ]);
  });
});
