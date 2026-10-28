import { ApplicationRef, type EmbeddedViewRef, type Type, type ViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button';
import { hlm } from '../ui/utils';
import { LOAD_SHELL_SHEET, Shell } from './shell';
import { skipLinkHref } from './skip-link';
import { LOAD_PAGE } from './follow-link';
import { PendingTestPage, PlainTestPage, SidebarTestPage } from './testing/test-pages';

async function render(
  page: Type<unknown>,
  url = '/',
  routes: Routes = [{ path: '**', component: page }],
): Promise<RouterTestingHarness> {
  TestBed.configureTestingModule({
    providers: [
      { provide: CONVEX_CLIENT, useValue: new FakeConvexClient() },
      provideRouter(routes),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return harness;
}

function host(harness: RouterTestingHarness): HTMLElement {
  return harness.fixture.nativeElement as HTMLElement;
}

function skipLink(harness: RouterTestingHarness): HTMLAnchorElement {
  const link = host(harness).querySelector('a');
  if (!link) throw new Error('no link rendered');
  return link;
}

function main(harness: RouterTestingHarness): HTMLElement {
  const element = host(harness).querySelector<HTMLElement>('main');
  if (!element) throw new Error('no main rendered');
  return element;
}

function menuButton(harness: RouterTestingHarness): HTMLButtonElement {
  const button = host(harness).querySelector<HTMLButtonElement>(
    'button[aria-label="Open navigation"]',
  );
  if (!button) throw new Error('no menu button rendered');
  return button;
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');

/** The shell attaches the sheet's host view there: it has no view container in its template, so the sheet's host element is in no document. */
function trackAppViews(onAttach?: (view: ViewRef) => void): {
  attached: ViewRef[];
  detached: ViewRef[];
} {
  const appRef = TestBed.inject(ApplicationRef);
  const attached: ViewRef[] = [];
  const detached: ViewRef[] = [];
  const attachView = appRef.attachView.bind(appRef);
  const detachView = appRef.detachView.bind(appRef);
  vi.spyOn(appRef, 'attachView').mockImplementation((view) => {
    attached.push(view);
    onAttach?.(view);
    attachView(view);
  });
  vi.spyOn(appRef, 'detachView').mockImplementation((view) => {
    detached.push(view);
    detachView(view);
  });
  return { attached, detached };
}

function sheetHostElement(view: ViewRef): Element {
  const [element] = (view as EmbeddedViewRef<unknown>).rootNodes as Node[];
  if (!(element instanceof Element)) throw new Error('the sheet view has no host element');
  return element;
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) await harness.fixture.whenStable();
}

describe('Shell', () => {
  describe('skip link', () => {
    it('is the first focusable element, reads "Skip to main content", and targets main#main', async () => {
      const harness = await render(PlainTestPage);
      const first = host(harness).querySelector('a[href], button, [tabindex]:not([tabindex="-1"])');
      expect(first).toBe(skipLink(harness));
      expect(skipLink(harness).textContent.trim()).toBe('Skip to main content');
      expect(main(harness).id).toBe('main');
      expect(main(harness).getAttribute('tabindex')).toBe('-1');
    });

    it('keeps the path and query string and adds #main', async () => {
      const harness = await render(PlainTestPage, '/organizations/x?y=1');
      expect(skipLink(harness).getAttribute('href')).toBe('/organizations/x?y=1#main');
    });

    it('replaces the current fragment with #main', async () => {
      const harness = await render(PlainTestPage, '/organizations/x?y=1#league-2');
      expect(skipLink(harness).getAttribute('href')).toBe('/organizations/x?y=1#main');
    });

    // An href starting with `//` (or `/\`, which browsers read the same way) would leave the site.
    // For `/(//evil.com)` the router's own `url` is `//evil.com`.
    for (const url of [
      '//evil.com/x',
      '///evil.com/x',
      '/(//evil.com)',
      '/(//(evil.com:////',
      '/%5Cevil.com/x',
      '/%2F%2Fevil.com',
    ]) {
      it(`starts with a single slash at ${url}`, async () => {
        const harness = await render(PlainTestPage, url);
        const href = skipLink(harness).getAttribute('href') ?? '';
        expect(href).toMatch(/^\/(?![/\\])/);
        expect(href.endsWith('#main')).toBe(true);
      });
    }

    // The serializer alone gives a leading `//` for these (an empty primary segment beside an
    // auxiliary route), so skipLinkHref collapses leading slashes whatever URL it is given.
    for (const [url, expected] of [
      ['/(//evil.com)', '/evil.com#main'],
      ['//(//evil.com:)', '/evil.com:#main'],
    ]) {
      it(`skipLinkHref keeps ${url} on this site`, () => {
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        expect(skipLinkHref(TestBed.inject(Router), url)).toBe(expected);
      });
    }

    it('skipLinkHref without the query keeps the path and drops the query and fragment', () => {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const router = TestBed.inject(Router);
      expect(skipLinkHref(router, '/organizations/x?ott=SECRET&y=1#top', false)).toBe(
        '/organizations/x#main',
      );
      expect(skipLinkHref(router, '/(//evil.com)?ott=SECRET', false)).toBe('/evil.com#main');
    });

    it('follows the URL after a navigation', async () => {
      const harness = await render(PlainTestPage, '/a');
      expect(skipLink(harness).getAttribute('href')).toBe('/a#main');
      await harness.navigateByUrl('/b?z=2#top');
      expect(skipLink(harness).getAttribute('href')).toBe('/b?z=2#main');
    });

    it('focuses main when activated, without leaving the page', async () => {
      const harness = await render(PlainTestPage, '/organizations/x');
      skipLink(harness).click();
      expect(document.activeElement).toBe(main(harness));
      expect(TestBed.inject(Router).url).toBe('/organizations/x');
    });
  });

  describe('slim bar', () => {
    it('is a header shown below 1024px only, with the menu button, the title, and the account initials', async () => {
      const harness = await render(PlainTestPage);
      const header = host(harness).querySelector('header')!;
      expect(header.classList).toContain('lg:hidden');
      expect(header.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();
      expect(header.querySelector('p')?.textContent).toBe('Omni League');
      expect(header.querySelector('app-account-row')).not.toBeNull();
      expect(header.querySelectorAll('a')).toHaveLength(0);
    });

    it("names the page's organization", async () => {
      const harness = await render(SidebarTestPage);
      expect(host(harness).querySelector('header p')?.textContent).toBe('Test organization');
    });

    it('has no Sign in link and no link to the public home', async () => {
      const harness = await render(PlainTestPage);
      expect(host(harness).querySelector('a[href^="/sign-in"]')).toBeNull();
      expect(host(harness).querySelector('header a[href="/"]')).toBeNull();
    });
  });

  describe('sidebar slot', () => {
    const column = (harness: RouterTestingHarness) =>
      main(harness).parentElement!.previousElementSibling!;

    it('without a sidebar template: renders the home sidebar and the account row in the column before main', async () => {
      const harness = await render(PlainTestPage);
      const navs = host(harness).querySelectorAll('nav');
      expect(navs).toHaveLength(1);
      expect(navs[0]?.getAttribute('aria-label')).toBe('Your account');
      expect(column(harness).contains(navs[0] ?? null)).toBe(true);
      expect(column(harness).querySelector('app-account-row')).not.toBeNull();
      expect(menuButton(harness)).not.toBeNull();
    });

    it('with a sidebar template: renders it once in the column, with the account row after it, and not the home sidebar', async () => {
      const harness = await render(SidebarTestPage);
      const navs = host(harness).querySelectorAll('nav[aria-label="Test organization"]');
      expect(navs).toHaveLength(1);
      expect(host(harness).querySelector('nav[aria-label="Your account"]')).toBeNull();
      const col = column(harness);
      expect(col.contains(navs[0] ?? null)).toBe(true);
      const row = col.querySelector('app-account-row')!;
      expect(navs[0].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const button = menuButton(harness);
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.hasAttribute('aria-controls')).toBe(false);
      expect(dialog()).toBeNull();
    });

    it('hides the column below 1024px and the top bar from 1024px', async () => {
      const harness = await render(SidebarTestPage);
      expect([...column(harness).classList]).toEqual(
        expect.arrayContaining(['hidden', 'lg:block']),
      );
      expect(host(harness).querySelector('header')?.classList).toContain('lg:hidden');
    });

    it('shows a loading skeleton, not the home sidebar, while the page waits for its sidebar', async () => {
      const harness = await render(PendingTestPage);
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(column(harness).querySelector('[role="status"]')?.textContent).toContain('Loading');
      expect(column(harness).querySelector('app-account-row')).not.toBeNull();
    });

    it('styles the menu button as hlmBtn variant="ghost" size="icon-lg"', async () => {
      const harness = await render(SidebarTestPage);
      const expected = hlm(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), '-ms-1.5');
      expect(menuButton(harness).className.split(/\s+/).sort()).toEqual(
        expected.split(/\s+/).sort(),
      );
    });

    it('creates no sheet until the menu button is pressed', async () => {
      const harness = await render(SidebarTestPage);
      expect(host(harness).querySelector('app-shell-sheet, hlm-sheet')).toBeNull();
    });
  });

  describe('phone sheet', () => {
    // jsdom lays nothing out, so the document is made taller than the viewport for the CDK block
    // scroll strategy to apply (it checks scrollHeight), and window.scroll, which jsdom does not
    // implement, is stubbed for the strategy's restore on close.
    beforeEach(() => {
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        get: () => window.innerHeight * 5,
      });
      vi.spyOn(window, 'scroll').mockImplementation(() => undefined);
      // jsdom has no scrollIntoView either; the link-close path calls it on the link's target.
      Element.prototype.scrollIntoView = () => undefined;
    });
    afterEach(() => {
      // Destroys a sheet left open while the stubs are still in place: its scroll strategy calls
      // window.scroll as it detaches.
      TestBed.resetTestingModule();
      Reflect.deleteProperty(document.documentElement, 'scrollHeight');
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      vi.restoreAllMocks();
    });

    let views: { attached: ViewRef[]; detached: ViewRef[] };

    async function press(harness: RouterTestingHarness): Promise<void> {
      const button = menuButton(harness);
      button.focus();
      button.click();
      await vi.waitFor(() => {
        expect(dialog()).not.toBeNull();
      });
      await settle(harness);
    }

    async function open(routes?: Routes, url = '/'): Promise<RouterTestingHarness> {
      const harness = await render(SidebarTestPage, url, routes);
      views = trackAppViews();
      await press(harness);
      return harness;
    }

    it('opens on the first press, once, however often the button is pressed while it loads', async () => {
      const harness = await render(SidebarTestPage);
      views = trackAppViews();
      const button = menuButton(harness);
      button.click();
      button.click();
      await vi.waitFor(() => {
        expect(dialog()).not.toBeNull();
      });
      await settle(harness);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(views.attached).toHaveLength(1);
    });

    it('points aria-controls at the open dialog, and sets no ARIA attribute on the sheet hosts', async () => {
      const harness = await open();
      const id = dialog()?.id;
      expect(id).toBeTruthy();
      expect(menuButton(harness).getAttribute('aria-controls')).toBe(id);
      const sheetHost = sheetHostElement(views.attached[0]);
      const sheetHosts = [sheetHost, ...sheetHost.querySelectorAll('hlm-sheet')];
      expect(sheetHosts.map((element) => element.localName)).toEqual([
        'app-shell-sheet',
        'hlm-sheet',
      ]);
      for (const sheetHost of sheetHosts) {
        expect(sheetHost.getAttributeNames().filter((name) => name.startsWith('aria-'))).toEqual(
          [],
        );
      }
    });

    it('opens again after a close, with the same sheet', async () => {
      const harness = await open();
      dialog()?.querySelector<HTMLElement>('[aria-label="Close navigation"]')?.click();
      await settle(harness);
      expect(dialog()).toBeNull();
      expect(menuButton(harness).hasAttribute('aria-controls')).toBe(false);

      menuButton(harness).click();
      await vi.waitFor(() => {
        expect(dialog()).not.toBeNull();
      });
      await settle(harness);
      expect(menuButton(harness).getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close navigation');
      expect(views.attached).toHaveLength(1);
    });

    it('opens a modal dialog named "Navigation" with the sidebar inside and focus on Close', async () => {
      const harness = await open();
      const sheet = dialog();
      expect(sheet).not.toBeNull();
      expect(sheet?.getAttribute('aria-modal')).toBe('true');
      expect(sheet?.getAttribute('aria-label')).toBe('Navigation');
      expect(sheet?.querySelector('nav[aria-label="Test organization"]')).not.toBeNull();
      expect(sheet?.querySelector('app-account-row')).not.toBeNull();
      expect(menuButton(harness).getAttribute('aria-expanded')).toBe('true');
      // The helm content's own "Close" button is hidden, so "Close navigation" is the only one.
      const buttons = sheet?.querySelectorAll('button') ?? [];
      expect([...buttons].map((button) => button.getAttribute('aria-label'))).toEqual([
        'Close navigation',
      ]);
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('blocks page scrolling while open', async () => {
      await open();
      expect(document.documentElement.classList).toContain('cdk-global-scrollblock');
    });

    // The sheet has no view container in the server-rendered template: its host view is attached to ApplicationRef, and its host element stays out of the document.
    // Only the CDK overlay container, which holds the dialog, is added to the body.
    it('keeps the sheet host out of the document: only the overlay container joins the body', async () => {
      const harness = await render(SidebarTestPage);
      views = trackAppViews();
      const bodyBefore = [...document.body.children];
      await press(harness);
      expect(views.attached).toHaveLength(1);
      expect(sheetHostElement(views.attached[0]).isConnected).toBe(false);
      expect(document.querySelector('app-shell-sheet, hlm-sheet')).toBeNull();
      const added = [...document.body.children].filter((child) => !bodyBefore.includes(child));
      expect(added.map((child) => child.className)).toEqual(['cdk-overlay-container']);
      expect(added[0].contains(dialog())).toBe(true);
    });

    it('destroys the sheet with the shell while open: detached, no scrim, no scroll block', async () => {
      const harness = await open();
      const [sheetView] = views.attached;
      expect(sheetView.destroyed).toBe(false);
      expect(document.documentElement.classList).toContain('cdk-global-scrollblock');

      harness.fixture.destroy();
      await flush();

      expect(sheetView.destroyed).toBe(true);
      expect(views.detached).toContain(sheetView);
      expectNoSheetLeft();
    });

    it('destroys a sheet whose first render throws, so the next press creates only one sheet', async () => {
      const harness = await render(SidebarTestPage);
      let failures = 1;
      views = trackAppViews((view) => {
        if (failures-- > 0) {
          vi.spyOn(view, 'detectChanges').mockImplementationOnce(() => {
            throw new Error('first render failed');
          });
        }
      });
      const shell = harness.fixture.debugElement.query(By.directive(Shell)).componentInstance as {
        openSheet(): Promise<void>;
      };

      await expect(shell.openSheet()).rejects.toThrow('first render failed');
      const [failed] = views.attached;
      expect(failed.destroyed).toBe(true);

      await press(harness);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(views.attached).toHaveLength(2);
      expect(views.attached.filter((view) => !view.destroyed)).toHaveLength(1);
    });

    const closePaths: [string, () => void][] = [
      [
        'Escape',
        () =>
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          ),
      ],
      [
        'Close',
        () => dialog()?.querySelector<HTMLElement>('[aria-label="Close navigation"]')?.click(),
      ],
      ['the scrim', () => document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click()],
      ['a link inside', () => dialog()?.querySelector<HTMLElement>('a.sidebar-link')?.click()],
    ];
    for (const [name, close] of closePaths) {
      it(`closed by ${name}: dialog gone, aria-expanded false, focus on the menu button, scroll unblocked`, async () => {
        const harness = await open();
        expect(dialog()).not.toBeNull();
        expect(document.documentElement.classList).toContain('cdk-global-scrollblock');
        close();
        await settle(harness);
        expect(dialog()).toBeNull();
        expect(menuButton(harness).getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(menuButton(harness));
        expect(document.documentElement.classList).not.toContain('cdk-global-scrollblock');
      });
    }

    it('follows a link only after the sheet has closed, then scrolls to its target', async () => {
      const harness = await open();
      const router = TestBed.inject(Router);
      const target = host(harness).querySelector<HTMLElement>('#row-2');
      if (!target) throw new Error('no target row');
      const scrolled: boolean[] = [];
      // Records whether the dialog was still open when the jump ran (jsdom has no scrollIntoView).
      target.scrollIntoView = () => scrolled.push(dialog() !== null);

      dialog()?.querySelector<HTMLElement>('a.sidebar-link')?.click();
      expect(router.url).toBe('/');
      await settle(harness);

      expect(router.url).toBe('/organizations/test#row-2');
      expect(scrolled).toEqual([false]);
    });

    it('keeps the current query string on a link to the current path, and replaces the fragment', async () => {
      const harness = await open(undefined, '/organizations/test?utm_source=x&ott=abc#top');
      const router = TestBed.inject(Router);
      const target = host(harness).querySelector<HTMLElement>('#row-2');
      if (!target) throw new Error('no target row');
      const scrolled: boolean[] = [];
      target.scrollIntoView = () => scrolled.push(dialog() !== null);

      dialog()?.querySelector<HTMLElement>('a.sidebar-link')?.click();
      expect(router.url).toBe('/organizations/test?utm_source=x&ott=abc#top');
      await settle(harness);

      expect(router.url).toBe('/organizations/test?utm_source=x&ott=abc#row-2');
      expect(scrolled).toEqual([false]);
    });

    it('navigates through the router to the link URL, with its own query string, for another path on the site', async () => {
      const loadPage = vi.fn<(url: string) => void>();
      TestBed.configureTestingModule({ providers: [{ provide: LOAD_PAGE, useValue: loadPage }] });
      const harness = await open(undefined, '/organizations/test?utm_source=x');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

      dialog()?.querySelector<HTMLElement>('a.other-path')?.click();
      await settle(harness);

      expect(dialog()).toBeNull();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/elsewhere?x=1#top');
      expect(TestBed.inject(Router).url).toBe('/elsewhere?x=1#top');
      expect(loadPage).not.toHaveBeenCalled();
    });

    it('loads a link to another origin as a full page, with no router navigation', async () => {
      const loadPage = vi.fn<(url: string) => void>();
      TestBed.configureTestingModule({ providers: [{ provide: LOAD_PAGE, useValue: loadPage }] });
      const harness = await open(undefined, '/organizations/test?utm_source=x');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

      dialog()?.querySelector<HTMLElement>('a.other-site')?.click();
      await settle(harness);

      expect(dialog()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(loadPage).toHaveBeenCalledExactlyOnceWith('https://example.com/a?b=1#c');
      expect(TestBed.inject(Router).url).toBe('/organizations/test?utm_source=x');
    });

    /** Macrotasks only: whenStable would also wait for a navigation held by a guard. */
    async function flush(): Promise<void> {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function expectNoSheetLeft(): void {
      expect(dialog()).toBeNull();
      expect(document.querySelector('.cdk-overlay-pane')).toBeNull();
      expect(document.querySelector('.cdk-overlay-backdrop')).toBeNull();
      expect(document.documentElement.classList).not.toContain('cdk-global-scrollblock');
    }

    describe('a press waiting on the sheet chunk', () => {
      function holdSheetImport(): { release: () => void; loads: () => number } {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let loads = 0;
        const load = async (): Promise<typeof import('./shell-sheet')> => {
          loads++;
          await held;
          return import('./shell-sheet');
        };
        TestBed.configureTestingModule({
          providers: [{ provide: LOAD_SHELL_SHEET, useValue: load }],
        });
        return { release, loads: () => loads };
      }

      it('is dropped when the shell is destroyed before the chunk loads', async () => {
        const hold = holdSheetImport();
        const harness = await render(SidebarTestPage);
        views = trackAppViews();
        menuButton(harness).click();
        expect(hold.loads()).toBe(1);
        harness.fixture.destroy();
        hold.release();
        await flush();
        expectNoSheetLeft();
        expect(document.querySelector('app-shell-sheet')).toBeNull();
        expect(views.attached).toEqual([]);
      });

      it('is dropped by Escape, and the next press opens the sheet', async () => {
        const hold = holdSheetImport();
        const harness = await render(SidebarTestPage);
        const button = menuButton(harness);
        button.focus();
        button.click();
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        hold.release();
        await flush();
        await settle(harness);
        expectNoSheetLeft();
        expect(button.getAttribute('aria-expanded')).toBe('false');

        button.click();
        await vi.waitFor(() => {
          expect(dialog()).not.toBeNull();
        });
        expect(hold.loads()).toBe(1);
      });

      it('is dropped by the start of a navigation that keeps the shell', async () => {
        const hold = holdSheetImport();
        const harness = await render(SidebarTestPage, '/a');
        const button = menuButton(harness);
        button.click();
        await harness.navigateByUrl('/b');
        expect(menuButton(harness)).toBe(button);
        hold.release();
        await flush();
        await settle(harness);
        expectNoSheetLeft();
      });
    });

    describe('with the sheet chunk loaded', () => {
      const pageRoutes: Routes = [
        { path: 'plain', component: PlainTestPage },
        { path: '**', component: SidebarTestPage },
      ];

      async function loadedSheet(routes: Routes): Promise<RouterTestingHarness> {
        const harness = await open(routes);
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await settle(harness);
        expect(dialog()).toBeNull();
        return harness;
      }

      it('does not open while a navigation is under way', async () => {
        let pass!: (value: boolean) => void;
        const guard = new Promise<boolean>((resolve) => {
          pass = resolve;
        });
        const harness = await loadedSheet([
          { path: 'held', canActivate: [() => guard], component: PlainTestPage },
          ...pageRoutes,
        ]);
        const router = TestBed.inject(Router);
        const navigation = router.navigateByUrl('/held');
        expect(router.currentNavigation()).not.toBeNull();
        menuButton(harness).click();
        await flush();
        expect(dialog()).toBeNull();

        pass(true);
        await navigation;
        await settle(harness);
        expect(router.url).toBe('/held');
        expectNoSheetLeft();
      });

      // The chunk is already in the module cache here, so the sheet is created and opened within
      // the same navigation that replaces the page.
      it('leaves nothing on the next page when a navigation follows the first press in the same turn', async () => {
        const harness = await render(SidebarTestPage, '/', pageRoutes);
        views = trackAppViews();
        const router = TestBed.inject(Router);
        menuButton(harness).click();
        const navigation = router.navigateByUrl('/plain');
        await navigation;
        await settle(harness);
        expect(router.url).toBe('/plain');
        expectNoSheetLeft();
        expect(views.attached.every((view) => view.destroyed)).toBe(true);
      });
    });

    it('loads the link as a full page when the router cannot navigate to it', async () => {
      const loadPage = vi.fn<(url: string) => void>();
      TestBed.configureTestingModule({ providers: [{ provide: LOAD_PAGE, useValue: loadPage }] });
      const harness = await open([{ path: '', component: SidebarTestPage }]);

      dialog()?.querySelector<HTMLElement>('a.sidebar-link')?.click();
      await settle(harness);

      expect(dialog()).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/');
      expect(loadPage).toHaveBeenCalledExactlyOnceWith(
        new URL('/organizations/test#row-2', document.baseURI).href,
      );
    });
  });
});
