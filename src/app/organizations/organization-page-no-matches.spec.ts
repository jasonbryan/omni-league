import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { api } from '../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../core/data/convex/testing/saved-copy';
import { LOAD_PAGE } from '../shell/follow-link';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import { SAND, sandResults } from './testing/pages';

const FACETS = 'organizations:listPublicLeagueFacets';
const ORG = `/organizations/${SAND.slug}`;
const MENS_SIX = `${ORG}?gender=mens&format=6v6`;
const NO_MATCHES = { gender: ['mens' as const], playersPerSide: [6] };

let client: FakeConvexClient;
let loadPage: ReturnType<typeof vi.fn>;

async function open(url: string, setUp?: () => void): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  loadPage = vi.fn();
  setUp?.();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug', component: OrganizationPage },
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

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

async function shown(
  url: string,
  results: Record<string, unknown>,
  except: readonly string[] = [],
): Promise<RouterTestingHarness> {
  const harness = await open(url);
  for (const name of Object.keys(results)) {
    if (!except.includes(name)) subscription(name).emit(results[name]);
  }
  await settle(harness);
  return harness;
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const box = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('#leagues > div');
const suggestions = (harness: RouterTestingHarness) => [
  ...(box(harness)?.querySelectorAll<HTMLAnchorElement>('ul a') ?? []),
];
const clearAll = (harness: RouterTestingHarness) =>
  [...(box(harness)?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].find(
    (a) => text(a) === 'Clear all',
  );
const skeleton = (harness: RouterTestingHarness) =>
  box(harness)?.querySelectorAll('[data-suggestions-skeleton] > span');
const count = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('form[aria-label="Filter leagues"] [role="status"]');
const url = () => TestBed.inject(Router).url;
const click = (element: HTMLElement | undefined) =>
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the no-matches suggestions after hydration', () => {
  it('names the filters and offers each value with the leagues its removal shows, the larger count first', async () => {
    const harness = await shown(MENS_SIX, sandResults(NO_MATCHES));
    expect(text(box(harness))).toContain(
      "Sand Org has no men's 6v6 league. Remove a filter to see more.",
    );
    expect(suggestions(harness).map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ["Remove Men's (3 leagues)", `${ORG}?format=6v6`],
      ['Remove 6v6 (1 league)', `${ORG}?gender=mens`],
    ]);
    expect(text(clearAll(harness))).toBe('Clear all');
  });

  it('keeps the Locations page and drops the leagues page in every link', async () => {
    const harness = await shown(`${MENS_SIX}&locations=2&leagues=2`, {
      ...sandResults({ ...NO_MATCHES, locations: 2 }),
      'organizations:listPublicLocations': {
        rows: SAND.locations,
        page: 2,
        pageCount: 2,
        total: 6,
      },
    });
    expect(suggestions(harness).map((a) => a.getAttribute('href'))).toEqual([
      `${ORG}?format=6v6&locations=2`,
      `${ORG}?gender=mens&locations=2`,
    ]);
  });

  it('names the value and the count in each link without an aria-label that replaces them', async () => {
    const harness = await shown(MENS_SIX, sandResults(NO_MATCHES));
    for (const link of suggestions(harness)) {
      expect(link.hasAttribute('aria-label')).toBe(false);
      expect(link.textContent).toMatch(/^Remove .+ \(\d+ leagues?\)$/);
    }
  });

  it('follows a pressed link by router navigation and moves focus to the count', async () => {
    const harness = await shown(MENS_SIX, sandResults(NO_MATCHES));
    click(suggestions(harness).find((a) => text(a) === 'Remove 6v6 (1 league)'));
    await settle(harness);
    expect(url()).toBe(`${ORG}?gender=mens`);
    expect(loadPage).not.toHaveBeenCalled();
    expect(subscription('organizations:listPublicLeagues').args).toEqual({
      slug: SAND.slug,
      page: 1,
      gender: ['mens'],
    });
    expect(document.activeElement).toBe(count(harness));
  });

  it('holds a skeleton with one pill per active value while the facets load, then swaps it for the links', async () => {
    const harness = await shown(MENS_SIX, sandResults(NO_MATCHES), [FACETS]);
    expect(skeleton(harness)).toHaveLength(2);
    expect(suggestions(harness)).toHaveLength(0);
    expect(text(box(harness))).toContain("Sand Org has no men's 6v6 league.");
    expect(text(clearAll(harness))).toBe('Clear all');

    subscription(FACETS).emit(sandResults(NO_MATCHES)[FACETS]);
    await settle(harness);
    expect(skeleton(harness)).toHaveLength(0);
    expect(suggestions(harness)).toHaveLength(2);
  });

  it('shows no suggestion and no skeleton offline when the saved copy has no facets', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const results = sandResults(NO_MATCHES);
    const args = { slug: SAND.slug, page: 1, gender: ['mens'], playersPerSide: [6] };
    const harness = await open(MENS_SIX, () => {
      const saved = Date.now() - 60_000;
      plantSavedCopy(
        api.organizations.getPublicPage,
        { slug: SAND.slug },
        results['organizations:getPublicPage'],
        saved,
      );
      plantSavedCopy(
        api.organizations.listPublicLeagues,
        args,
        results['organizations:listPublicLeagues'],
        saved,
      );
      plantSavedCopy(
        api.organizations.listPublicLocations,
        { slug: SAND.slug, page: 1 },
        results['organizations:listPublicLocations'],
        saved,
      );
      plantSavedCopy(
        api.seasons.listOpenForOrganization,
        { orgSlug: SAND.slug, gender: ['mens'], playersPerSide: [6] },
        results['seasons:listOpenForOrganization'],
        saved,
      );
      client.setConnected(false, { neverConnected: true });
    });
    await settle(harness);
    expect(text(box(harness))).toContain(
      "Sand Org has no men's 6v6 league. Remove a filter to see more.",
    );
    expect(text(clearAll(harness))).toBe('Clear all');
    expect(suggestions(harness)).toHaveLength(0);
    expect(skeleton(harness)).toHaveLength(0);
  });
});
