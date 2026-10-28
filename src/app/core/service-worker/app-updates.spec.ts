import { Location } from '@angular/common';
import { Component, DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { makeFunctionReference } from 'convex/server';
import { AuthService } from '../auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../auth/testing/fake-auth-client';
import { ChangesInFlight } from '../changes-in-flight';
import { CONVEX_CLIENT, injectMutation } from '../data/convex';
import { FakeConvexClient } from '../data/convex/testing/fake-convex-client';
import {
  ACTIVATE_TIMEOUT_MS,
  AUTO_APPLY_WINDOW_MS,
  AppUpdates,
  PAGE_LOADED_AT,
  RELOAD_PAGE,
  STALE_PAGE_AGE_MS,
  UPDATE_CHECK_INTERVAL_MS,
} from './app-updates';
import { FakeSwUpdate, resetVisibility, setVisibility } from './testing/fake-sw-update';

@Component({ template: '' })
class EmptyPage {}

const DAY = 24 * 60 * 60 * 1000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const START = new Date('2026-10-09T12:00:00Z').getTime();
const LEGACY_FIRST_RUN_KEY = 'omni-league:sw-version-first-run';

describe('AppUpdates', () => {
  let sw: FakeSwUpdate;
  let reload: ReturnType<typeof vi.fn>;
  let fields: HTMLElement[];

  function setUp(loadedAgo = 0): AppUpdates {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyPage }]),
        { provide: SwUpdate, useValue: sw },
        { provide: RELOAD_PAGE, useValue: reload },
        { provide: PAGE_LOADED_AT, useValue: START - loadedAgo },
      ],
    });
    return TestBed.inject(AppUpdates);
  }

  /** The first navigation only records where the page is, so it is never a trigger. */
  async function startOn(path = '/home', loadedAgo = 0): Promise<AppUpdates> {
    const updates = setUp(loadedAgo);
    updates.start();
    await navigate(path);
    return updates;
  }

  async function navigate(url: string): Promise<void> {
    await TestBed.inject(Router).navigateByUrl(url);
    await vi.advanceTimersByTimeAsync(0);
  }

  function typeInto(): HTMLInputElement {
    const input = document.createElement('input');
    document.body.append(input);
    fields.push(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  function touch(): void {
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  }

  function passTime(ms: number): void {
    vi.setSystemTime(Date.now() + ms);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(START);
    localStorage.clear();
    sessionStorage.clear();
    fields = [];
    sw = new FakeSwUpdate();
    reload = vi.fn();
  });

  afterEach(() => {
    for (const field of fields) field.remove();
    resetVisibility();
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('with the worker off (development builds, the server, no browser support)', () => {
    it('does not start: no prompt, no document or window listeners, no update checks', () => {
      sw.isEnabled = false;
      const check = vi.spyOn(sw, 'checkForUpdate');
      const updates = setUp();
      const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener');

      expect(updates.start()).toBe(false);
      sw.versionReady('a');
      sw.broken();
      passTime(DAY);
      setVisibility('visible');

      expect(addListener).not.toHaveBeenCalled();
      expect(updates.card()).toBe('none');
      expect(check).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('removes the first-run record that earlier versions kept', () => {
      localStorage.setItem(LEGACY_FIRST_RUN_KEY, '{"a":1}');
      localStorage.setItem('other', 'kept');
      setUp().start();

      expect(localStorage.getItem(LEGACY_FIRST_RUN_KEY)).toBeNull();
      expect(localStorage.getItem('other')).toBe('kept');
    });

    it('works when storage cannot be written', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(setUp().start()).toBe(true);
    });

    it('starts once: a second start() adds no second subscription', async () => {
      const updates = setUp();
      const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener');
      expect(updates.start()).toBe(true);
      const added = addListener.mock.calls.length;
      expect(updates.start()).toBe(true);
      expect(addListener.mock.calls.length).toBe(added);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('a new version early in the page load (criterion 1)', () => {
    it('activates it and reloads at once on an untouched, safe page, with no prompt', async () => {
      const activate = vi.spyOn(sw, 'activateUpdate');
      const updates = await startOn();
      passTime(5 * SECOND);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(updates.card()).toBe('none');
      expect(activate).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(activate.mock.invocationCallOrder[0]).toBeLessThan(
        reload.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('reloads the page as it is when the reload happens, at the same URL', async () => {
      const paths: string[] = [];
      reload.mockImplementation(() => paths.push(TestBed.inject(Location).path()));
      await startOn('/league/sharks');
      passTime(3 * SECOND);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(paths).toEqual(['/league/sharks']);
    });

    it('still reloads at the end of the load window', async () => {
      await startOn();
      passTime(AUTO_APPLY_WINDOW_MS);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('waits for a path-changing navigation when the version is ready after the load window, even with no interaction', async () => {
      const updates = await startOn();
      passTime(AUTO_APPLY_WINDOW_MS + 1);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(updates.card()).toBe('none');
      expect(reload).not.toHaveBeenCalled();

      await navigate('/next');
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('waits for a navigation on a page the user has touched', async () => {
      const updates = await startOn();
      touch();
      passTime(2 * SECOND);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(updates.card()).toBe('none');
      expect(reload).not.toHaveBeenCalled();
    });

    it.each(['keydown', 'wheel', 'touchstart'])(
      'counts %s as interaction as well',
      async (type) => {
        await startOn();
        document.dispatchEvent(new Event(type, { bubbles: true }));

        sw.versionReady('a', 'b');
        await vi.advanceTimersByTimeAsync(0);

        expect(reload).not.toHaveBeenCalled();
      },
    );
  });

  describe('a path-changing navigation (criterion 2)', () => {
    async function readyOnTouchedPage() {
      const activate = vi.spyOn(sw, 'activateUpdate');
      const updates = await startOn();
      touch();
      passTime(MINUTE);
      sw.versionReady('a', 'b');
      return { updates, activate };
    }

    it('activates the update and reloads once, with no prompt', async () => {
      const { updates, activate } = await readyOnTouchedPage();

      await navigate('/next');

      expect(updates.card()).toBe('none');
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

    it('loads the destination URL', async () => {
      const paths: string[] = [];
      reload.mockImplementation(() => paths.push(TestBed.inject(Location).path()));
      await readyOnTouchedPage();

      await navigate('/next');

      expect(paths).toEqual(['/next']);
    });

    it('does not reload for a query-only or fragment-only navigation', async () => {
      await readyOnTouchedPage();

      await navigate('/home?tab=teams');
      await navigate('/home?tab=teams#row-3');
      await navigate('/home#top');

      expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload when a page younger than 7 days is hidden and shown again', async () => {
      await readyOnTouchedPage();

      setVisibility('hidden');
      setVisibility('visible');
      passTime(2 * DAY);
      setVisibility('hidden');
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
    });

    it('does not count the first navigation as a path change', async () => {
      const updates = setUp();
      updates.start();
      touch();
      sw.versionReady('a', 'b');

      await navigate('/first');

      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('a long-open page that comes back to the front (criterion 2a)', () => {
    it('activates a ready update and reloads when the page becomes visible and is older than 7 days', async () => {
      const activate = vi.spyOn(sw, 'activateUpdate');
      const updates = await startOn('/home', STALE_PAGE_AGE_MS + MINUTE);
      passTime(MINUTE);
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('none');

      setVisibility('hidden');
      expect(reload).not.toHaveBeenCalled();
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);

      expect(activate).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a page that loaded 7 days ago or less', async () => {
      await startOn('/home', STALE_PAGE_AGE_MS);
      sw.versionReady('a', 'b');

      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
    });

    it('does nothing while an unsaved field is on screen, and the prompt shows', async () => {
      const updates = await startOn('/home', 8 * DAY);
      typeInto();
      sw.versionReady('a', 'b');

      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });

    it('does nothing when no update is ready', async () => {
      const activate = vi.spyOn(sw, 'activateUpdate');
      await startOn('/home', 8 * DAY);

      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);

      expect(activate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('treats a version that is ready within the load window of the return as part of the return', async () => {
      await startOn('/home', 8 * DAY);
      setVisibility('visible');
      passTime(5 * SECOND);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('waits when the version is ready later than that after the return', async () => {
      await startOn('/home', 8 * DAY);
      setVisibility('visible');
      passTime(AUTO_APPLY_WINDOW_MS + 1);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
    });

    it('waits when the page is younger than 7 days, even right after a return', async () => {
      await startOn('/home', 6 * DAY);
      setVisibility('visible');

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('unsaved input (criterion 3)', () => {
    it('shows the prompt and reloads nothing when the version is ready while a field is unsaved', async () => {
      const updates = await startOn();
      const input = typeInto();
      input.value = 'maya@example.com';

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(updates.card()).toBe('ready');
      expect(reload).not.toHaveBeenCalled();
      expect(input.value).toBe('maya@example.com');
    });

    it('checks safety when the reload is about to happen: ready on a safe page, then typing, then leaving the field on screen through a navigation', async () => {
      const updates = await startOn();
      touch();
      passTime(MINUTE);
      sw.versionReady('a', 'b');
      expect(updates.card()).toBe('none');

      typeInto();
      expect(updates.card()).toBe('ready');
      await navigate('/next');

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });

    it('shows the prompt when the user types inside the load window after the version is ready', async () => {
      const updates = await startOn();
      touch();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();

      typeInto();

      expect(updates.card()).toBe('ready');
    });

    it('shows the prompt at a path change that keeps the field on screen, and reloads once the field has gone', async () => {
      const updates = await startOn();
      const input = typeInto();
      passTime(MINUTE);
      sw.versionReady('a', 'b');
      await navigate('/next');
      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');

      input.remove();
      await navigate('/after');

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload for a query-only navigation while a form with an unsaved field stays on screen', async () => {
      const updates = await startOn('/league');
      typeInto();
      passTime(MINUTE);
      sw.versionReady('a', 'b');

      await navigate('/league?tab=teams');

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });

    it('does not reload because an unrelated change resolved while the field is still on screen', async () => {
      const updates = await startOn();
      typeInto();
      passTime(MINUTE);
      sw.versionReady('a', 'b');
      TestBed.inject(ChangesInFlight).begin()();
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });
  });

  describe('new-version prompt actions (criterion 4)', () => {
    async function promptShowing() {
      const updates = await startOn();
      typeInto();
      sw.versionReady('a', 'b');
      return updates;
    }

    it('Reload reloads the page', async () => {
      const updates = await promptShowing();

      updates.reload();

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('Later hides the prompt, and the update still applies at the next safe path-changing navigation', async () => {
      const updates = await promptShowing();

      updates.later();
      expect(updates.card()).toBe('none');
      for (const field of fields) field.remove();
      await navigate('/next');

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('Later keeps the prompt hidden for the page session, for a later version and for new typing', async () => {
      const updates = await promptShowing();
      updates.later();

      sw.versionReady('a', 'c');
      typeInto();
      await navigate('/next');

      expect(updates.card()).toBe('none');
      expect(reload).not.toHaveBeenCalled();
    });

    it('ignores the other version events', async () => {
      const updates = await startOn();
      sw.versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
      sw.versionUpdates.next({
        type: 'VERSION_INSTALLATION_FAILED',
        version: { hash: 'b' },
        error: 'x',
      });
      sw.noNewVersion('a');
      await vi.advanceTimersByTimeAsync(0);

      expect(updates.card()).toBe('none');
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('a change in flight (criterion 5)', () => {
    it('holds an early reload until the change settles, then reloads', async () => {
      const updates = await startOn();
      const end = TestBed.inject(ChangesInFlight).begin();

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('none');

      end();
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('holds the reload at a path change until the change settles, then reloads', async () => {
      const updates = await startOn();
      touch();
      passTime(MINUTE);
      sw.versionReady('a', 'b');
      const end = TestBed.inject(ChangesInFlight).begin();

      await navigate('/next');
      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('none');

      end();
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload when the change settles after the user typed', async () => {
      const updates = await startOn();
      const end = TestBed.inject(ChangesInFlight).begin();
      sw.versionReady('a', 'b');
      typeInto();

      end();
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });

    it('does not reload at the end of a change once the load window and the untouched page are gone', async () => {
      await startOn();
      const end = TestBed.inject(ChangesInFlight).begin();
      sw.versionReady('a', 'b');
      passTime(AUTO_APPLY_WINDOW_MS + 1);

      end();
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('real requests in flight (criterion 5)', () => {
    const credentials = { email: 'maya.okafor@example.com', password: 'sandbar sunset spike 2026' };

    it('holds an early reload while a sign-in request is unanswered, then reloads', async () => {
      const auth = new FakeAuthClient();
      auth.holdSignIn = true;
      TestBed.configureTestingModule({ providers: [provideFakeAuthClient(auth)] });
      await startOn();
      const signIn = TestBed.inject(AuthService).signIn(credentials);
      await vi.advanceTimersByTimeAsync(0);

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();

      auth.releaseSignIn();
      await signIn;
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('holds a reload at a path change while a mutation is unanswered, then reloads', async () => {
      const convex = new FakeConvexClient();
      TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: convex }] });
      await startOn();
      const createTeam = TestBed.runInInjectionContext(() =>
        injectMutation(makeFunctionReference<'mutation', { name: string }, string>('teams:create')),
      );
      touch();
      sw.versionReady('a', 'b');
      const saved = createTeam.run({ name: 'Sharks' });

      await navigate('/next');
      expect(reload).not.toHaveBeenCalled();

      convex.calls[0].resolve('team1');
      await saved;
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads once a sign-in that failed has settled', async () => {
      const auth = new FakeAuthClient();
      auth.holdSignIn = true;
      auth.signInThrows = new Error('network');
      TestBed.configureTestingModule({ providers: [provideFakeAuthClient(auth)] });
      await startOn();
      const signIn = TestBed.inject(AuthService).signIn(credentials);
      await vi.advanceTimersByTimeAsync(0);
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();

      auth.releaseSignIn();
      await signIn;
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('unrecoverable state (criterion 7)', () => {
    function online(value: boolean): void {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
    }

    it('reloads once, with no message, when the page is safe and online', async () => {
      const activate = vi.spyOn(sw, 'activateUpdate');
      const updates = await startOn();
      online(true);

      sw.broken();
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
      expect(activate).not.toHaveBeenCalled();
      expect(updates.card()).toBe('none');
    });

    it('shows the message, never a second reload, in a tab that already reloaded for it', async () => {
      const updates = await startOn();
      online(true);
      sw.broken();
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('shows the message when this tab reloaded for it before (a new page in the same tab)', async () => {
      await startOn();
      online(true);
      sw.broken();
      await vi.advanceTimersByTimeAsync(0);
      TestBed.resetTestingModule();
      sw = new FakeSwUpdate();
      reload.mockClear();
      const updates = await startOn();

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).not.toHaveBeenCalled();
    });

    it('shows the message when offline', async () => {
      const updates = await startOn();
      online(false);

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).not.toHaveBeenCalled();
    });

    it('shows the message while a field is unsaved', async () => {
      const updates = await startOn();
      online(true);
      typeInto();

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).not.toHaveBeenCalled();
    });

    it('shows the message while a change is in flight', async () => {
      const updates = await startOn();
      online(true);
      TestBed.inject(ChangesInFlight).begin();

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).not.toHaveBeenCalled();
    });

    it('keeps the message when Later was pressed or another version is ready', async () => {
      const updates = await startOn();
      online(false);
      typeInto();
      sw.versionReady('a', 'b');
      updates.later();

      sw.broken();
      expect(updates.card()).toBe('unrecoverable');

      sw.versionReady('a', 'c');
      expect(updates.card()).toBe('unrecoverable');

      updates.reload();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('shows the message when session storage cannot be read', async () => {
      const updates = await startOn();
      online(true);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).not.toHaveBeenCalled();
    });

    it('shows the message when session storage cannot be written', async () => {
      const updates = await startOn();
      online(true);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      sw.broken();

      expect(updates.card()).toBe('unrecoverable');
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('no reload loop (criterion 8)', () => {
    it('shows the prompt, not a second reload, for a version this tab already reloaded for', async () => {
      await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);

      TestBed.resetTestingModule();
      sw = new FakeSwUpdate();
      reload.mockClear();
      const updates = await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(updates.card()).toBe('ready');
      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads for a different version in the same tab', async () => {
      await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      TestBed.resetTestingModule();
      sw = new FakeSwUpdate();
      reload.mockClear();
      await startOn();
      sw.versionReady('b', 'c');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('shows the prompt for a repeated version even at a later path change on a safe page', async () => {
      sessionStorage.setItem('omni-league:sw-reloaded-for', JSON.stringify(['b']));
      const updates = await startOn();
      touch();
      sw.versionReady('a', 'b');
      expect(updates.card()).toBe('ready');

      await navigate('/next');

      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads nothing and shows the prompt when session storage cannot be read', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const updates = await startOn();

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      await navigate('/next');

      expect(updates.card()).toBe('ready');
      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads nothing and shows the prompt when session storage cannot be written', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const updates = await startOn();

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(updates.card()).toBe('ready');
      expect(reload).not.toHaveBeenCalled();
    });

    it('ignores a stored value that is not a list of hashes', async () => {
      sessionStorage.setItem('omni-league:sw-reloaded-for', '{"b":');
      await startOn();

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('safety is checked again after the activation wait (criterion 3)', () => {
    function holdActivation(): { finish: () => void } {
      let finish: (value: boolean) => void = () => undefined;
      vi.spyOn(sw, 'activateUpdate').mockImplementationOnce(
        () => new Promise<boolean>((resolve) => (finish = resolve)),
      );
      return { finish: () => finish(true) };
    }

    it('does not reload when the user types while activateUpdate() is pending, and shows the prompt', async () => {
      const { finish } = holdActivation();
      const updates = await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      typeInto();
      finish();
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });

    it('does not reload when a change starts while activateUpdate() is pending, and reloads once it settles', async () => {
      const { finish } = holdActivation();
      await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      const end = TestBed.inject(ChangesInFlight).begin();
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).not.toHaveBeenCalled();

      end();
      await vi.advanceTimersByTimeAsync(0);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload when the activation wait times out after the user typed', async () => {
      vi.spyOn(sw, 'activateUpdate').mockReturnValueOnce(new Promise<boolean>(() => undefined));
      const updates = await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      typeInto();
      await vi.advanceTimersByTimeAsync(ACTIVATE_TIMEOUT_MS);

      expect(reload).not.toHaveBeenCalled();
      expect(updates.card()).toBe('ready');
    });

    it('still applies at a later safe navigation once the held field has gone', async () => {
      const { finish } = holdActivation();
      await startOn();
      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);
      const input = typeInto();
      finish();
      await vi.advanceTimersByTimeAsync(0);

      input.remove();
      await navigate('/next');

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('activation failure (criterion 9)', () => {
    it('reloads when activateUpdate() fails', async () => {
      vi.spyOn(sw, 'activateUpdate').mockImplementationOnce(() =>
        Promise.reject(new Error('no worker')),
      );
      await startOn();

      sw.versionReady('a', 'b');
      await vi.advanceTimersByTimeAsync(0);

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads after a short wait when activateUpdate() never settles', async () => {
      vi.spyOn(sw, 'activateUpdate').mockReturnValueOnce(new Promise<boolean>(() => undefined));
      await startOn();
      sw.versionReady('a', 'b');

      await vi.advanceTimersByTimeAsync(ACTIVATE_TIMEOUT_MS - 1);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(reload).toHaveBeenCalledTimes(1);
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

describe('PAGE_LOADED_AT', () => {
  it('is performance.timeOrigin by default', () => {
    expect(TestBed.inject(PAGE_LOADED_AT)).toBe(performance.timeOrigin);
  });
});
