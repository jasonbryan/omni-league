import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { getFunctionName } from 'convex/server';
import { api } from '../../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { OFFLINE_SAVED_QUERIES } from '../../core/data/convex/offline-saved-queries';
import { savedCopyKey } from '../../core/data/convex/saved-copies';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../../core/data/convex/testing/saved-copy';
import { formatSavedTime } from '../../offline/saved-time';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicTournamentPage } from './public-tournament-page';
import {
  BEACH_OPEN,
  TOURNAMENT_ARGS,
  TOURNAMENT_PATH,
  tournamentQueryResults,
} from './testing/tournament-data';

const NOW = Date.UTC(2027, 3, 1, 14, 30);
const SAVED_AT = Date.UTC(2027, 3, 1, 2, 14);
const TOURNAMENT = 'tournaments:getPublicPage';

let client: FakeConvexClient;

function plant(results = tournamentQueryResults(), savedAt = SAVED_AT): void {
  plantSavedCopy(api.tournaments.getPublicPage, TOURNAMENT_ARGS, results[TOURNAMENT], savedAt);
}

const savedEntry = () =>
  localStorage.getItem(savedCopyKey(api.tournaments.getPublicPage, TOURNAMENT_ARGS));

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

async function open(url = TOURNAMENT_PATH, options: { socket?: 'up' | 'down' } = {}) {
  client = new FakeConvexClient();
  if (options.socket === 'down') client.setConnected(false, { neverConnected: true });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'organizations/:orgSlug/tournaments/:tournamentSlug',
          component: PublicTournamentPage,
        },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await settle(harness);
  return harness;
}

function subscription(): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === TOURNAMENT);
  expect(active).toHaveLength(1);
  return active[0];
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main [data-saved-copy-note]');

describe('PublicTournamentPage offline', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('lists the page’s own query with its returns validator', () => {
    const listed = new Set(OFFLINE_SAVED_QUERIES.map((entry) => getFunctionName(entry.query)));
    expect(listed.has(TOURNAMENT)).toBe(true);
  });

  describe('a saved copy, opened offline', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      plant();
      stubOnLine(false);
      harness = await open(TOURNAMENT_PATH, { socket: 'down' });
    });

    it('shows the tournament and its details from the saved copy', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('Gulf Coast Beach Open');
      expect(text(main?.querySelector('dl'))).toContain('Jun 12 – Jun 13, 2027');
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Gulf Coast Beach Open | Gulf Coast Sport & Social | Omni League',
      );
    });

    it('shows the saved-copy note under the heading lines, with the saved time', () => {
      const expected = formatSavedTime(SAVED_AT, NOW);
      const header = host(harness).querySelector('main h1')?.parentElement;
      expect(header?.lastElementChild?.tagName).toBe('APP-SAVED-COPY-NOTE');
      expect(text(note(harness))).toBe(
        `Saved copy from ${expected.text}. It may have changed since.`,
      );
    });

    it('is replaced by the live result when the connection returns, and the note goes', async () => {
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      subscription().emit({ ...BEACH_OPEN, name: 'Gulf Coast Beach Open Live' });
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Beach Open Live');
      expect(note(harness)).toBeNull();
      expect(JSON.parse(savedEntry() ?? 'null')).toMatchObject({
        v: { name: 'Gulf Coast Beach Open Live' },
        savedAt: NOW,
      });
    });
  });

  it('online before the first live result: shows the saved copy with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Beach Open');
    expect(note(harness)).toBeNull();
  });

  describe('no saved copy', () => {
    it('offline: shows the not-saved view at once, with Try again to the tournament page asked for', async () => {
      plant();
      stubOnLine(false);
      const other = TOURNAMENT_PATH.replace('gulf-coast-beach-open', 'winter-doubles-classic');
      const harness = await open(`${other}?ott=SECRET#details`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe(other);
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
    });

    it.each([
      ['a shape that is not a tournament', { name: 'Shape Only' }],
      ['a minimum that is not a number', { ...BEACH_OPEN, minimumRosterSize: '2' }],
      ['a number', 42],
    ])(
      'offline with an unusable saved copy (%s): shows the not-saved view and removes it',
      async (_, value) => {
        plantSavedCopy(api.tournaments.getPublicPage, TOURNAMENT_ARGS, value, SAVED_AT);
        stubOnLine(false);
        const errors = vi.spyOn(console, 'error');
        const harness = await open(TOURNAMENT_PATH, { socket: 'down' });
        expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
        expect(savedEntry()).toBeNull();
        expect(errors).not.toHaveBeenCalled();
      },
    );
  });

  it('a live null removes the saved tournament and shows the not-found view with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    subscription().emit(null);
    await settle(harness);
    expect(savedEntry()).toBeNull();
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(note(harness)).toBeNull();
  });
});
