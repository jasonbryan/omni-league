import { Component, DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import {
  ACTIVATE_TIMEOUT_MS,
  AppUpdates,
  FIRST_RUN_MAX_ENTRIES,
  FIRST_RUN_STORAGE_KEY,
  RELOAD_PAGE,
  UPDATE_CHECK_INTERVAL_MS,
} from './app-updates';
import { FakeSwUpdate, resetVisibility, setVisibility } from './testing/fake-sw-update';

@Component({ template: '' })
class EmptyPage {}

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const START = new Date('2026-10-09T12:00:00Z').getTime();

function storedFirstRuns(): Record<string, number> {
  return JSON.parse(localStorage.getItem(FIRST_RUN_STORAGE_KEY) ?? '{}') as Record<string, number>;
}

describe('AppUpdates', () => {
  let sw: FakeSwUpdate;
  let reload: ReturnType<typeof vi.fn>;

  function setUp(): AppUpdates {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyPage }]),
        { provide: SwUpdate, useValue: sw },
        { provide: RELOAD_PAGE, useValue: reload },
      ],
    });
    return TestBed.inject(AppUpdates);
  }

  async function navigate(url: string): Promise<void> {
    await TestBed.inject(Router).navigateByUrl(url);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(START);
    localStorage.clear();
    sw = new FakeSwUpdate();
    reload = vi.fn();
  });

  afterEach(() => {
    resetVisibility();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('with the worker off (development builds, the server, no browser support)', () => {
    it('does not start: no card, no listeners, no update checks', () => {
      sw.isEnabled = false;
      const check = vi.spyOn(sw, 'checkForUpdate');
      const updates = setUp();

      expect(updates.start()).toBe(false);
      sw.versionReady('a');
      sw.broken();
      vi.setSystemTime(START + DAY);
      setVisibility('visible');

      expect(updates.card()).toBe('none');
      expect(check).not.toHaveBeenCalled();
      expect(localStorage.getItem(FIRST_RUN_STORAGE_KEY)).toBeNull();
    });
  });

  describe('new-version prompt', () => {
    it('shows the prompt on VERSION_READY', () => {
      const updates = setUp();
      updates.start();
      expect(updates.card()).toBe('none');

      sw.versionReady('a');

      expect(updates.card()).toBe('ready');
    });

    it('Reload reloads the page', () => {
      const updates = setUp();
      updates.start();
      sw.versionReady('a');

      updates.reload();

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('Later hides the prompt for the rest of the page session, even for a later version', () => {
      const updates = setUp();
      updates.start();
      sw.versionReady('a', 'b');

      updates.later();
      expect(updates.card()).toBe('none');

      sw.versionReady('a', 'c');
      expect(updates.card()).toBe('none');
      expect(reload).not.toHaveBeenCalled();
    });

    it('ignores the other version events', () => {
      const updates = setUp();
      updates.start();
      sw.versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
      sw.versionUpdates.next({
        type: 'VERSION_INSTALLATION_FAILED',
        version: { hash: 'b' },
        error: 'x',
      });
      sw.noNewVersion('a');

      expect(updates.card()).toBe('none');
    });

    it('starts once: a second start() adds no second subscription', () => {
      const updates = setUp();
      expect(updates.start()).toBe(true);
      expect(updates.start()).toBe(true);
      expect(sw.versionUpdates.observed).toBe(true);
      sw.versionReady('a');
      updates.reload();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('unrecoverable state', () => {
    it('shows the reload message, which Later never hid and a version event does not replace', () => {
      const updates = setUp();
      updates.start();
      sw.versionReady('a');
      updates.later();

      sw.broken();
      expect(updates.card()).toBe('unrecoverable');

      sw.versionReady('a', 'c');
      expect(updates.card()).toBe('unrecoverable');

      updates.reload();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('forced reload past 14 days (ADR 0013 section 4)', () => {
    function runningFor(days: number) {
      const activate = vi.spyOn(sw, 'activateUpdate');
      const updates = setUp();
      updates.start();
      sw.noNewVersion('a');
      vi.setSystemTime(START + days * DAY);
      return { updates, activate };
    }

    it('at 15 days shows no prompt and waits while the page stays visible and nothing navigates', async () => {
      const { updates, activate } = runningFor(15);
      setVisibility('visible');
      sw.versionReady('a');

      expect(updates.card()).toBe('none');
      await vi.advanceTimersByTimeAsync(60 * MINUTE);
      expect(activate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('at 15 days activates the update and reloads once at the next router navigation', async () => {
      const { activate } = runningFor(15);
      sw.versionReady('a');

      await navigate('/next');
      await vi.advanceTimersByTimeAsync(0);

      expect(activate).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(activate.mock.invocationCallOrder[0]).toBeLessThan(
        reload.mock.invocationCallOrder[0] ?? 0,
      );

      await navigate('/again');
      setVisibility('hidden');
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(activate).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('at 15 days activates the update and reloads once when the page next becomes visible', async () => {
      const { activate } = runningFor(15);
      sw.versionReady('a');

      setVisibility('hidden');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();

      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(activate).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);

      await navigate('/next');
      await vi.advanceTimersByTimeAsync(0);
      expect(activate).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('at 13 days shows the prompt and defers nothing', async () => {
      const { updates, activate } = runningFor(13);
      sw.versionReady('a');

      expect(updates.card()).toBe('ready');
      await navigate('/next');
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(activate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads when activateUpdate() fails', async () => {
      const { activate } = runningFor(15);
      activate.mockReturnValueOnce(Promise.reject(new Error('no worker')));
      sw.versionReady('a');
      await navigate('/next');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads after a short wait when activateUpdate() never settles', async () => {
      const { activate } = runningFor(15);
      activate.mockReturnValueOnce(new Promise<boolean>(() => undefined));
      sw.versionReady('a');
      await navigate('/next');

      await vi.advanceTimersByTimeAsync(ACTIVATE_TIMEOUT_MS - 1);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('first-run record (localStorage)', () => {
    it('records the running version from VERSION_READY or NO_NEW_VERSION_DETECTED, once', () => {
      const updates = setUp();
      updates.start();
      sw.noNewVersion('a');
      vi.setSystemTime(START + DAY);
      sw.noNewVersion('a');
      sw.versionReady('b', 'c');

      expect(storedFirstRuns()).toEqual({ a: START, b: START + DAY });
    });

    // A newly opened page runs the newest version the worker has, so NO_NEW_VERSION_DETECTED names the running version until this page learns of a newer one.
    it('after VERSION_READY, records the running version, never the downloaded one', () => {
      const updates = setUp();
      updates.start();
      sw.versionReady('a', 'b');
      vi.setSystemTime(START + DAY);
      sw.noNewVersion('b');

      expect(storedFirstRuns()).toEqual({ a: START });
    });

    it('records nothing for NO_NEW_VERSION_DETECTED while a detected version is downloading', () => {
      const updates = setUp();
      updates.start();
      sw.versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
      sw.noNewVersion('b');

      expect(storedFirstRuns()).toEqual({});
    });

    it('treats a version with no record as first run now, so it shows the prompt', () => {
      const updates = setUp();
      updates.start();
      vi.setSystemTime(START + 30 * DAY);
      sw.versionReady('never-seen');
      expect(updates.card()).toBe('ready');
    });

    it(`keeps the ${String(FIRST_RUN_MAX_ENTRIES)} newest records`, () => {
      const updates = setUp();
      updates.start();
      for (let i = 0; i < FIRST_RUN_MAX_ENTRIES + 3; i++) {
        vi.setSystemTime(START + i * MINUTE);
        sw.noNewVersion(`v${String(i)}`);
      }
      const hashes = Object.keys(storedFirstRuns()).sort();
      expect(hashes).toHaveLength(FIRST_RUN_MAX_ENTRIES);
      expect(hashes).not.toContain('v0');
      expect(hashes).toContain(`v${String(FIRST_RUN_MAX_ENTRIES + 2)}`);
    });

    it('ignores a stored value that is not a record of times', () => {
      localStorage.setItem(FIRST_RUN_STORAGE_KEY, '{"a":"yesterday","b":');
      const updates = setUp();
      updates.start();
      sw.versionReady('a');
      expect(updates.card()).toBe('ready');
      expect(storedFirstRuns()).toEqual({ a: START });
    });

    it('works with no usable storage: it shows the prompt and never forces a reload', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const updates = setUp();
      updates.start();
      sw.noNewVersion('a');
      vi.setSystemTime(START + 30 * DAY);
      sw.versionReady('a');
      await navigate('/next');
      expect(updates.card()).toBe('ready');
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('update check when the page becomes visible', () => {
    it('checks when the page becomes visible, then at most once every 30 minutes', () => {
      const check = vi.spyOn(sw, 'checkForUpdate');
      const updates = setUp();
      updates.start();

      vi.setSystemTime(START + 5 * MINUTE);
      setVisibility('visible');
      expect(check).toHaveBeenCalledTimes(1);

      vi.setSystemTime(START + 20 * MINUTE);
      setVisibility('visible');
      expect(check).toHaveBeenCalledTimes(1);

      vi.setSystemTime(START + 5 * MINUTE + UPDATE_CHECK_INTERVAL_MS - 1);
      setVisibility('visible');
      expect(check).toHaveBeenCalledTimes(1);

      vi.setSystemTime(START + 5 * MINUTE + UPDATE_CHECK_INTERVAL_MS);
      setVisibility('visible');
      expect(check).toHaveBeenCalledTimes(2);
    });

    it('does not check when the page becomes hidden', () => {
      const check = vi.spyOn(sw, 'checkForUpdate');
      const updates = setUp();
      updates.start();
      vi.setSystemTime(START + 2 * UPDATE_CHECK_INTERVAL_MS);
      setVisibility('hidden');
      expect(check).not.toHaveBeenCalled();
    });

    it('swallows a failed check (offline)', async () => {
      const check = vi
        .spyOn(sw, 'checkForUpdate')
        .mockReturnValue(Promise.reject(new Error('offline')));
      const updates = setUp();
      updates.start();
      vi.setSystemTime(START + UPDATE_CHECK_INTERVAL_MS);
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RELOAD_PAGE', () => {
  it('is document.location.reload() by default', () => {
    const reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { location: { reload } } }],
    });

    TestBed.inject(RELOAD_PAGE)();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
