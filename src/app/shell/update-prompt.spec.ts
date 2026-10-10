import { ApplicationRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { AppUpdates, RELOAD_PAGE } from '../core/service-worker/app-updates';
import { FakeSwUpdate } from '../core/service-worker/testing/fake-sw-update';
import { buttonVariants } from '../ui/button';
import { hlm } from '../ui/utils';
import { provideUpdatePrompt, UpdatePrompt } from './update-prompt';

/** Stands in for `ResizeObserver` (jsdom has none): keeps the callback so a test can fire it. */
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

const CARD_CLASSES =
  'fixed inset-x-3 bottom-3 z-40 rounded-xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] ' +
  'text-card-foreground shadow-lg ring-1 ring-foreground/10 sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-96';

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const sorted = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();

describe('UpdatePrompt', () => {
  let sw: FakeSwUpdate;
  let reload: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<UpdatePrompt>;
  let host: HTMLElement;

  const card = () => host.querySelector<HTMLElement>('section');
  const status = () => host.querySelector<HTMLElement>('[role="status"]');
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((candidate) => text(candidate) === name);

  beforeEach(() => {
    FakeResizeObserver.last = undefined;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    sw = new FakeSwUpdate();
    reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SwUpdate, useValue: sw },
        { provide: RELOAD_PAGE, useValue: reload },
      ],
    });
    TestBed.inject(AppUpdates).start();
    fixture = TestBed.createComponent(UpdatePrompt);
    host = fixture.nativeElement as HTMLElement;
    TestBed.tick();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows nothing until the worker has a new version, with an empty status region', () => {
    expect(card()).toBeNull();
    expect(status()?.classList).toContain('sr-only');
    expect(text(status())).toBe('');
  });

  describe('new version ready', () => {
    beforeEach(() => {
      sw.versionReady('a');
      TestBed.tick();
    });

    it('shows the card with the approved text, labelled by its heading, not as an alert', () => {
      const section = card();
      expect(section).not.toBeNull();
      expect(sorted(section?.className ?? '')).toEqual(sorted(CARD_CLASSES));
      expect(section?.hasAttribute('role')).toBe(false);
      const heading = section?.querySelector('h2');
      expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
      expect(text(heading)).toBe('A new version of Omni League is ready');
      expect(text(section?.querySelector('p'))).toBe(
        "Reload to start using it. Finish anything you're typing first.",
      );
    });

    it('announces it once in the polite status region', () => {
      expect(text(status())).toBe('A new version of Omni League is ready.');
    });

    it('has Reload (default button, icon first) and Later (ghost button)', () => {
      const reloadButton = button('Reload');
      const laterButton = button('Later');
      expect(reloadButton?.type).toBe('button');
      expect(sorted(reloadButton?.className ?? '')).toEqual(sorted(hlm(buttonVariants())));
      expect(reloadButton?.querySelector('ng-icon')?.getAttribute('data-icon')).toBe(
        'inline-start',
      );
      expect(laterButton?.type).toBe('button');
      expect(sorted(laterButton?.className ?? '')).toEqual(
        sorted(hlm(buttonVariants({ variant: 'ghost' }))),
      );
      for (const icon of card()?.querySelectorAll('ng-icon') ?? []) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
      const tile = card()?.querySelector('span');
      expect(sorted(tile?.className ?? '')).toEqual(
        sorted(
          'flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground',
        ),
      );
    });

    it('does not take focus', () => {
      expect(card()?.contains(document.activeElement)).toBe(false);
    });

    it('Reload reloads the page', () => {
      button('Reload')?.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('Later hides the card and empties the status region', () => {
      button('Later')?.click();
      TestBed.tick();
      expect(card()).toBeNull();
      expect(text(status())).toBe('');
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe('unrecoverable state', () => {
    beforeEach(() => {
      sw.broken();
      TestBed.tick();
    });

    it('shows the reload message as an alert, with a destructive tile and Reload only', () => {
      const section = card();
      expect(section?.getAttribute('role')).toBe('alert');
      expect(sorted(section?.className ?? '')).toEqual(sorted(CARD_CLASSES));
      const heading = section?.querySelector('h2');
      expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
      expect(text(heading)).toBe('Omni League needs to reload');
      expect(text(section?.querySelector('p'))).toBe(
        'Part of the app could not be loaded after an update. Reload to keep going.',
      );
      expect([...(section?.querySelectorAll('button') ?? [])].map(text)).toEqual(['Reload']);
      expect(sorted(section?.querySelector('span')?.className ?? '')).toEqual(
        sorted(
          'flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive',
        ),
      );
      expect(text(status())).toBe('');
    });

    it('Reload reloads the page', () => {
      button('Reload')?.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('room for the card (WCAG 2.4.11)', () => {
    const root = document.documentElement;

    it('pads the page and its scroll offset by the card and its gap, and clears both when it goes', () => {
      sw.versionReady('a');
      TestBed.tick();
      const section = card();
      if (!section) throw new Error('no card');
      vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ height: 140 } as DOMRect);
      section.style.bottom = '12px';
      FakeResizeObserver.last?.callback();

      expect(root.style.scrollPaddingBottom).toBe('152px');
      expect(document.body.style.paddingBottom).toBe('152px');

      button('Later')?.click();
      TestBed.tick();
      expect(FakeResizeObserver.last?.disconnected).toBe(true);
      expect(root.style.scrollPaddingBottom).toBe('');
      expect(document.body.style.paddingBottom).toBe('');
    });
  });
});

describe('provideUpdatePrompt', () => {
  afterEach(() => {
    for (const element of document.body.querySelectorAll('app-update-prompt')) element.remove();
  });

  function bootWith(sw: FakeSwUpdate): void {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SwUpdate, useValue: sw }, provideUpdatePrompt()],
    });
    TestBed.inject(ApplicationRef);
  }

  it('adds the prompt at the end of <body>, after the app, when the worker is on', () => {
    bootWith(new FakeSwUpdate());
    const prompts = document.body.querySelectorAll('app-update-prompt');
    expect(prompts).toHaveLength(1);
    expect(document.body.lastElementChild).toBe(prompts[0]);
  });

  it('adds nothing when the worker is off (development builds, the server render)', () => {
    const sw = new FakeSwUpdate();
    sw.isEnabled = false;
    bootWith(sw);
    expect(document.body.querySelector('app-update-prompt')).toBeNull();
  });
});
