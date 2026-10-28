import { TestBed } from '@angular/core/testing';
import { getFunctionName } from 'convex/server';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { OFFLINE_SAVED_QUERIES } from '../core/data/convex/offline-saved-queries';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import type { PublicOrganizationPage } from './organization-path';
import { GULF_COAST, PORT_ARANSAS, queryResults, sportQueryResults } from './testing/pages';

const VIEWER_IS_ORG_ADMIN = 'organizations:viewerIsOrgAdmin';
const ORG = '/organizations/gulf-coast-sport-social';

let client: FakeConvexClient;

async function open(url = ORG): Promise<RouterTestingHarness> {
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

async function signIn(harness: RouterTestingHarness): Promise<void> {
  TestBed.inject(AuthService).onChange(true);
  await settle(harness);
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function emit(
  harness: RouterTestingHarness,
  results: Record<string, unknown>,
): Promise<void> {
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
  await settle(harness);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const manage = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll<HTMLAnchorElement>('main a[data-slot="button"]')].find(
    (link) => link.textContent?.trim() === 'Manage',
  );
const actionRow = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('[data-hero-actions]');
const viewerSubscriptions = () =>
  client.activeSubscriptions.filter((s) => s.name === VIEWER_IS_ORG_ADMIN);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('OrganizationPage Manage', () => {
  it('opens no viewerIsOrgAdmin subscription for a signed-out visitor', async () => {
    const harness = await open();
    await emit(harness, queryResults(GULF_COAST));
    expect(viewerSubscriptions()).toHaveLength(0);
    expect(manage(harness)).toBeUndefined();
  });

  it('asks once signed in, with the slug of the route only', async () => {
    const harness = await open(`${ORG}?ott=SECRET`);
    await emit(harness, queryResults(GULF_COAST));
    await signIn(harness);
    expect(viewerSubscriptions().map(({ args }) => args)).toEqual([
      { slug: 'gulf-coast-sport-social' },
    ]);
  });

  it('shows no Manage while the answer is loading, and keeps the action row at 44px', async () => {
    const harness = await open();
    await emit(harness, queryResults(GULF_COAST));
    await signIn(harness);
    expect(manage(harness)).toBeUndefined();
    expect(actionRow(harness)?.classList).toContain('min-h-11');
  });

  it('shows Manage to an org admin, linking to the admin area of the organization', async () => {
    const harness = await open();
    await emit(harness, queryResults(GULF_COAST));
    await signIn(harness);
    await emit(harness, { [VIEWER_IS_ORG_ADMIN]: true });
    expect(manage(harness)?.getAttribute('href')).toBe(
      '/app/organizations/gulf-coast-sport-social',
    );
  });

  it('shows no Manage when the answer is false', async () => {
    const harness = await open();
    await emit(harness, queryResults(GULF_COAST));
    await signIn(harness);
    await emit(harness, { [VIEWER_IS_ORG_ADMIN]: false });
    expect(manage(harness)).toBeUndefined();
  });

  it('shows Manage on the sport view too', async () => {
    const harness = await open(`${ORG}/sports/soccer`);
    await emit(harness, sportQueryResults(GULF_COAST, 'soccer'));
    await signIn(harness);
    await emit(harness, { [VIEWER_IS_ORG_ADMIN]: true });
    expect(manage(harness)).toBeDefined();
  });

  it('shows Manage on an organization with no leagues', async () => {
    const harness = await open(`/organizations/${PORT_ARANSAS.slug}`);
    await emit(harness, queryResults(PORT_ARANSAS));
    await signIn(harness);
    await emit(harness, { [VIEWER_IS_ORG_ADMIN]: true });
    expect(manage(harness)).toBeDefined();
  });

  describe('the hero action row', () => {
    const NO_OPEN: PublicOrganizationPage = { ...GULF_COAST, openSeasons: [] };

    it.each([
      ['no season is open', NO_OPEN],
      ['the organization has no leagues', PORT_ARANSAS],
    ])('keeps its 44px height when %s, for every visitor', async (_name, page) => {
      const harness = await open(`/organizations/${page.slug}`);
      await emit(harness, queryResults(page));
      const row = actionRow(harness);
      expect(row).not.toBeNull();
      expect(row?.classList).toContain('min-h-11');
    });

    it('does not move the section under the hero when Manage appears', async () => {
      const harness = await open();
      await emit(harness, queryResults(NO_OPEN));
      await signIn(harness);
      const before = actionRow(harness)?.getBoundingClientRect().height;
      await emit(harness, { [VIEWER_IS_ORG_ADMIN]: true });
      expect(actionRow(harness)?.getBoundingClientRect().height).toBe(before);
    });
  });
});

describe('OFFLINE_SAVED_QUERIES', () => {
  it('does not include viewerIsOrgAdmin', () => {
    const names = OFFLINE_SAVED_QUERIES.map(({ query }) => getFunctionName(query));
    expect(names).not.toContain(VIEWER_IS_ORG_ADMIN);
  });
});
