import { ApplicationInitStatus, ApplicationRef, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { AppUpdates, RELOAD_PAGE, type UpdateCard } from '../core/service-worker/app-updates';
import { FakeSwUpdate } from '../core/service-worker/testing/fake-sw-update';
import { UpdatePrompt } from './update-prompt';
import { provideUpdatePrompt, UPDATE_PROMPT_LOADER } from './update-prompt-provider';

class FakeResizeObserver {
  static last: FakeResizeObserver | undefined;
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.last = this;
  }
  observe(): void {
    // The test fires the callback itself.
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const classesOf = (element: Element | null | undefined) =>
  (element?.className ?? '').split(/\s+/).filter(Boolean).sort();
const flushPromises = () => new Promise<void>((done) => setTimeout(done, 0));

const READY_TEXT = 'A new version of Omni League is ready.';
const RELOAD_TITLE = 'Omni League needs to reload';
const RELOAD_TEXT = 'Part of the app could not be loaded after an update. Reload to keep going.';
const RELOADED_FOR_KEY = 'omni-league:sw-reloaded-for';

describe('provideUpdatePrompt', () => {
  let sw: FakeSwUpdate;
  let reload: ReturnType<typeof vi.fn>;
  let loaded: Deferred<Type<unknown>>;
  let loader: ReturnType<typeof vi.fn>;
  let appRoot: HTMLElement;
  let unsavedField: HTMLInputElement | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;

  const fallback = () => document.body.querySelector<HTMLElement>('app-update-fallback');
  const prompts = () => [...document.body.querySelectorAll<HTMLElement>('app-update-prompt')];
  const statusRegions = () => [...document.querySelectorAll<HTMLElement>('[role="status"]')];
  const cards = () => [...document.body.querySelectorAll<HTMLElement>('section[data-slot="card"]')];
  const alerts = () => [...document.body.querySelectorAll<HTMLElement>('[role="alert"]')];
  const reloadButton = (within: ParentNode) =>
    [...within.querySelectorAll('button')].find((candidate) => text(candidate) === 'Reload');

  function boot(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SwUpdate, useValue: sw },
        { provide: RELOAD_PAGE, useValue: reload },
        { provide: UPDATE_PROMPT_LOADER, useValue: loader },
        provideUpdatePrompt(),
      ],
    });
    TestBed.inject(ApplicationRef);
    TestBed.tick();
  }

  /** Unsaved input is what keeps a version from loading by itself, so a card shows. */
  function typeIntoField(): void {
    unsavedField = document.createElement('input');
    document.body.append(unsavedField);
    unsavedField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function settle(): Promise<void> {
    await flushPromises();
    TestBed.tick();
  }

  beforeEach(() => {
    FakeResizeObserver.last = undefined;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sw = new FakeSwUpdate();
    reload = vi.fn();
    loaded = deferred<Type<unknown>>();
    loader = vi.fn(() => loaded.promise);
    appRoot = document.createElement('app-root');
    document.body.append(appRoot);
  });

  afterEach(() => {
    unsavedField?.remove();
    unsavedField = undefined;
    appRoot.remove();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    for (const element of document.body.querySelectorAll('app-update-prompt, app-update-fallback'))
      element.remove();
    document.body.style.removeProperty('padding-bottom');
    document.documentElement.style.removeProperty('scroll-padding-bottom');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('initializer', () => {
    it('appends the fallback at the end of <body> and calls the loader once when the worker is on', () => {
      boot();
      expect(fallback()).not.toBeNull();
      expect(document.body.lastElementChild).toBe(fallback());
      expect(loader).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(0);
    });

    it('never calls the loader and adds nothing when the worker is off (development builds, the server render)', async () => {
      sw.isEnabled = false;
      boot();
      await settle();
      expect(loader).not.toHaveBeenCalled();
      expect(fallback()).toBeNull();
      expect(prompts()).toHaveLength(0);
      expect(statusRegions()).toHaveLength(0);
    });

    it('returns before a loader that never settles, so the app renders and becomes stable', async () => {
      boot();
      expect(TestBed.inject(ApplicationInitStatus).done).toBe(true);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(statusRegions()).toHaveLength(1);
      expect(prompts()).toHaveLength(0);
    });

    it('defaults to a loader that imports the prompt component', async () => {
      TestBed.configureTestingModule({});
      const defaultLoader = TestBed.inject(UPDATE_PROMPT_LOADER);
      expect(await defaultLoader()).toBe(UpdatePrompt);
    });
  });

  describe('one prompt', () => {
    it('is created once, after the app and after the fallback, whatever the card does later', async () => {
      const card = signal<UpdateCard>('none');
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: AppUpdates,
            useValue: { start: () => true, card: card.asReadonly(), reload, later: vi.fn() },
          },
          { provide: UPDATE_PROMPT_LOADER, useValue: loader },
          provideUpdatePrompt(),
        ],
      });
      TestBed.inject(ApplicationRef);
      TestBed.tick();
      loaded.resolve(UpdatePrompt);
      await settle();

      const expectOnePrompt = () => {
        expect(prompts()).toHaveLength(1);
        const order = [...document.body.children];
        expect(order.indexOf(prompts()[0])).toBeGreaterThan(order.indexOf(fallback()!));
        expect(order.indexOf(fallback()!)).toBeGreaterThan(order.indexOf(appRoot));
        expect(document.body.lastElementChild).toBe(prompts()[0]);
      };
      expectOnePrompt();
      for (const next of ['ready', 'none', 'ready'] as const) {
        card.set(next);
        TestBed.tick();
        await flushPromises();
        expectOnePrompt();
      }
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('status region', () => {
    it('is in the page empty from the first render, and holds the text only once the prompt has loaded', async () => {
      boot();
      typeIntoField();
      const status = statusRegions()[0];
      expect(statusRegions()).toHaveLength(1);
      expect(status?.classList).toContain('sr-only');
      expect(text(status)).toBe('');

      sw.versionReady('a');
      TestBed.tick();
      expect(text(status)).toBe('');
      expect(cards()).toHaveLength(0);

      loaded.resolve(UpdatePrompt);
      await settle();

      expect(statusRegions()).toEqual([status]);
      expect(text(status)).toBe(READY_TEXT);
      expect(prompts()[0]?.querySelector('[role="status"]')).toBeNull();
      expect(fallback()?.contains(status as Node)).toBe(true);
    });

    it('stays empty after the card goes away', async () => {
      boot();
      typeIntoField();
      loaded.resolve(UpdatePrompt);
      await settle();
      sw.versionReady('a');
      TestBed.tick();
      expect(text(statusRegions()[0])).toBe(READY_TEXT);

      TestBed.inject(AppUpdates).later();
      TestBed.tick();
      expect(text(statusRegions()[0])).toBe('');
    });
  });

  describe('the fallback message', () => {
    function expectMessage(): HTMLElement {
      const alert = alerts()[0];
      expect(alerts()).toHaveLength(1);
      expect(alert?.tagName).toBe('SECTION');
      expect(alert?.getAttribute('data-slot')).toBe('card');
      const heading = alert?.querySelector('h2');
      expect(alert?.getAttribute('aria-labelledby')).toBe(heading?.id);
      expect(text(heading)).toBe(RELOAD_TITLE);
      expect(text(alert?.querySelector('p'))).toBe(RELOAD_TEXT);
      expect([...(alert?.querySelectorAll('button') ?? [])].map(text)).toEqual(['Reload']);
      expect(alert?.querySelector('svg')).toBeNull();
      return alert;
    }

    it('shows when the loader has rejected and the worker then loses files', async () => {
      boot();
      typeIntoField();
      loaded.reject(new TypeError('Failed to fetch dynamically imported module'));
      await settle();
      expect(alerts()).toHaveLength(0);

      sw.broken();
      TestBed.tick();

      const alert = expectMessage();
      expect(prompts()).toHaveLength(0);
      expect(text(statusRegions()[0])).toBe('');
      expect(alert.classList).toContain('fixed');
      reloadButton(alert)?.click();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('shows when the worker lost files before the loader rejected', async () => {
      boot();
      typeIntoField();
      sw.broken();
      loaded.reject(new TypeError('Failed to fetch dynamically imported module'));
      await settle();

      expectMessage();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('shows while the loader is still pending, and the Reload button reloads', () => {
      boot();
      typeIntoField();
      sw.broken();
      TestBed.tick();

      const alert = expectMessage();
      reloadButton(alert)?.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reserves room for the card at the bottom of the page and gives it back when the message goes', async () => {
      boot();
      typeIntoField();
      sw.broken();
      TestBed.tick();
      const alert = expectMessage();
      vi.spyOn(alert, 'getBoundingClientRect').mockReturnValue({ height: 140 } as DOMRect);
      alert.style.bottom = '12px';
      FakeResizeObserver.last?.callback();

      expect(document.body.style.paddingBottom).toBe('152px');
      expect(document.documentElement.style.scrollPaddingBottom).toBe('152px');

      loaded.resolve(UpdatePrompt);
      await settle();
      const promptCard = cards()[0];
      expect(promptCard?.getAttribute('role')).toBe('alert');
      vi.spyOn(promptCard, 'getBoundingClientRect').mockReturnValue({
        height: 160,
      } as DOMRect);
      promptCard.style.bottom = '12px';
      FakeResizeObserver.last?.callback();
      expect(document.body.style.paddingBottom).toBe('172px');
    });

    describe('hand-off to the prompt', () => {
      it('removes the message when the prompt loads, shows one card at every step, and moves focus to the prompt Reload', async () => {
        boot();
        typeIntoField();
        sw.broken();
        TestBed.tick();
        const fallbackReload = reloadButton(expectMessage());
        fallbackReload?.focus();
        expect(document.activeElement).toBe(fallbackReload);

        loaded.resolve(UpdatePrompt);
        await flushPromises();
        expect(new Set([...alerts(), ...cards()]).size).toBe(1);
        TestBed.tick();

        expect(prompts()).toHaveLength(1);
        expect(fallback()?.querySelector('section')).toBeNull();
        const promptCard = cards()[0];
        expect(cards()).toHaveLength(1);
        expect(alerts()).toEqual([promptCard]);
        expect(promptCard?.getAttribute('role')).toBe('alert');
        expect(text(promptCard?.querySelector('h2'))).toBe(RELOAD_TITLE);
        expect(document.activeElement).toBe(reloadButton(promptCard));
        expect(document.body.style.paddingBottom).not.toBe('');
      });

      it('draws its card as the prompt does: the same card classes, and a Reload button with classes the prompt button also has', async () => {
        boot();
        typeIntoField();
        sw.broken();
        TestBed.tick();
        const message = expectMessage();
        const fallbackCard = classesOf(message);
        const fallbackButton = classesOf(reloadButton(message));

        loaded.resolve(UpdatePrompt);
        await settle();

        const promptCard = cards()[0];
        expect(fallbackCard).toEqual(classesOf(promptCard));
        const promptButton = classesOf(reloadButton(promptCard));
        expect(fallbackButton.filter((name) => !promptButton.includes(name))).toEqual([]);
        expect(fallbackButton).toEqual(
          expect.arrayContaining(['h-8', 'px-2.5', 'bg-primary', 'text-primary-foreground']),
        );
      });

      it('leaves focus where it was when it was not on the fallback Reload', async () => {
        boot();
        typeIntoField();
        const other = document.createElement('button');
        document.body.append(other);
        sw.broken();
        TestBed.tick();
        other.focus();

        loaded.resolve(UpdatePrompt);
        await settle();

        expect(document.activeElement).toBe(other);
        other.remove();
      });

      it('shows the ready card for a version that became ready while the loader was pending', async () => {
        boot();
        typeIntoField();
        sw.versionReady('a');
        TestBed.tick();
        expect(cards()).toHaveLength(0);
        expect(alerts()).toHaveLength(0);

        loaded.resolve(UpdatePrompt);
        await settle();

        expect(cards()).toHaveLength(1);
        expect(text(cards()[0]?.querySelector('h2'))).toBe('A new version of Omni League is ready');
        expect(alerts()).toHaveLength(0);
        expect(text(statusRegions()[0])).toBe(READY_TEXT);
      });
    });

    describe('a ready version that cannot apply itself after the loader rejected', () => {
      async function bootWithRejectedLoader(): Promise<void> {
        boot();
        loaded.reject(new TypeError('Failed to fetch dynamically imported module'));
        await settle();
      }

      it('shows the message for unsaved input, with the status region empty and no error logged', async () => {
        await bootWithRejectedLoader();
        typeIntoField();

        sw.versionReady('a');
        TestBed.tick();

        expect(expectMessage()).not.toBeNull();
        expect(text(statusRegions()[0])).toBe('');
        expect(consoleError).not.toHaveBeenCalled();
      });

      it('shows the message when the reload guard refused a second time for that hash', async () => {
        sessionStorage.setItem(RELOADED_FOR_KEY, JSON.stringify(['a-next']));
        await bootWithRejectedLoader();

        sw.versionReady('a');
        TestBed.tick();

        expectMessage();
        expect(text(statusRegions()[0])).toBe('');
        expect(consoleError).not.toHaveBeenCalled();
      });

      it('shows the message when sessionStorage is not usable', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new DOMException('denied', 'SecurityError');
        });
        await bootWithRejectedLoader();

        sw.versionReady('a');
        TestBed.tick();

        expectMessage();
        expect(text(statusRegions()[0])).toBe('');
        expect(consoleError).not.toHaveBeenCalled();
      });

      it('shows the message when the version became ready while the loader was pending and the loader then rejects', async () => {
        boot();
        typeIntoField();
        sw.versionReady('a');
        TestBed.tick();
        expect(alerts()).toHaveLength(0);

        loaded.reject(new TypeError('Failed to fetch dynamically imported module'));
        await settle();

        expectMessage();
        expect(prompts()).toHaveLength(0);
        expect(text(statusRegions()[0])).toBe('');
        expect(consoleError).not.toHaveBeenCalled();
      });

      it('shows nothing when no version is ready and nothing is lost', async () => {
        await bootWithRejectedLoader();
        expect(alerts()).toHaveLength(0);
        expect(cards()).toHaveLength(0);
      });
    });
  });
});
