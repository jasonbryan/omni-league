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
import { PublicTrainingPage } from './public-training-page';
import {
  TRAINING_ARGS,
  TRAINING_PATH,
  TUESDAY_CLINIC,
  trainingQueryResults,
} from './testing/training-data';

const NOW = Date.UTC(2027, 0, 20, 14, 30);
const SAVED_AT = Date.UTC(2027, 0, 20, 2, 14);
const TRAINING = 'trainings:getPublicPage';

let client: FakeConvexClient;

function plant(results = trainingQueryResults(), savedAt = SAVED_AT): void {
  plantSavedCopy(api.trainings.getPublicPage, TRAINING_ARGS, results[TRAINING], savedAt);
}

const savedEntry = () =>
  localStorage.getItem(savedCopyKey(api.trainings.getPublicPage, TRAINING_ARGS));

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

async function open(url = TRAINING_PATH, options: { socket?: 'up' | 'down' } = {}) {
  client = new FakeConvexClient();
  if (options.socket === 'down') client.setConnected(false, { neverConnected: true });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug/training/:trainingSlug', component: PublicTrainingPage },
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
  const active = client.activeSubscriptions.filter((s) => s.name === TRAINING);
  expect(active).toHaveLength(1);
  return active[0];
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main [data-saved-copy-note]');

describe('PublicTrainingPage offline', () => {
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
    expect(listed.has(TRAINING)).toBe(true);
  });

  describe('a saved copy, opened offline', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      plant();
      stubOnLine(false);
      harness = await open(TRAINING_PATH, { socket: 'down' });
    });

    it('shows the training program and its classes from the saved copy', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('Tuesday Serving Clinic');
      expect(main?.querySelectorAll('#classes li')).toHaveLength(3);
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Tuesday Serving Clinic | Gulf Coast Sport & Social | Omni League',
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
      subscription().emit({ ...TUESDAY_CLINIC, name: 'Tuesday Serving Clinic Live' });
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Tuesday Serving Clinic Live');
      expect(note(harness)).toBeNull();
      expect(JSON.parse(savedEntry() ?? 'null')).toMatchObject({
        v: { name: 'Tuesday Serving Clinic Live' },
        savedAt: NOW,
      });
    });
  });

  it('online before the first live result: shows the saved copy with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe('Tuesday Serving Clinic');
    expect(note(harness)).toBeNull();
  });

  describe('no saved copy', () => {
    it('offline: shows the not-saved view at once, with Try again to the training page asked for', async () => {
      plant();
      stubOnLine(false);
      const other = TRAINING_PATH.replace('tuesday-serving-clinic', 'other-clinic');
      const harness = await open(`${other}?ott=SECRET#classes`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe(other);
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
    });

    it.each([
      ['a shape that is not a training program', { name: 'Shape Only' }],
      [
        'a places count that is not a number',
        {
          ...TUESDAY_CLINIC,
          classes: [{ ...TUESDAY_CLINIC.classes[0], placesLeft: '3' }],
        },
      ],
      ['a number', 42],
    ])(
      'offline with an unusable saved copy (%s): shows the not-saved view and removes it',
      async (_, value) => {
        plantSavedCopy(api.trainings.getPublicPage, TRAINING_ARGS, value, SAVED_AT);
        stubOnLine(false);
        const errors = vi.spyOn(console, 'error');
        const harness = await open(TRAINING_PATH, { socket: 'down' });
        expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
        expect(savedEntry()).toBeNull();
        expect(errors).not.toHaveBeenCalled();
      },
    );
  });

  it('a live null removes the saved training program and shows the not-found view with no note', async () => {
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
