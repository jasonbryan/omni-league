import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LOAD_PAGE, skipLinkHref } from './shell';
import { PlainTestPage, SidebarTestPage } from './testing/test-pages';

async function render(
  page: Type<unknown>,
  url = '/',
  routes: Routes = [{ path: '**', component: page }],
): Promise<RouterTestingHarness> {
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
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

/** Lets the sheet's afterNextRender work (initial focus, close) and its close promise finish. */
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

  describe('top bar', () => {
    it('is a header with the logo and "Omni League" linking to /', async () => {
      const harness = await render(PlainTestPage);
      const header = host(harness).querySelector('header');
      const home = header?.querySelector('a');
      expect(home?.getAttribute('href')).toBe('/');
      expect(home?.textContent.trim()).toBe('Omni League');
      expect(home?.querySelector('ng-icon[aria-hidden="true"] svg')).not.toBeNull();
      expect(host(harness).textContent).not.toContain('Sign in');
    });
  });

  describe('sidebar slot', () => {
    it('without a sidebar template: no sidebar column, no menu button, and no nav', async () => {
      const harness = await render(PlainTestPage);
      expect(host(harness).querySelector('button')).toBeNull();
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(main(harness).parentElement?.children).toHaveLength(1);
    });

    it('with a sidebar template: renders it once, in a column before main, and the menu button', async () => {
      const harness = await render(SidebarTestPage);
      const navs = host(harness).querySelectorAll('nav[aria-label="Test organization"]');
      expect(navs).toHaveLength(1);
      expect(main(harness).previousElementSibling?.contains(navs[0])).toBe(true);
      const button = menuButton(harness);
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('type')).toBe('button');
      expect(dialog()).toBeNull();
    });

    it('sets no ARIA attribute on the sheet host itself', async () => {
      const harness = await render(SidebarTestPage);
      const sheet = host(harness).querySelector('hlm-sheet');
      expect(sheet).not.toBeNull();
      expect(sheet?.getAttributeNames().filter((name) => name.startsWith('aria-'))).toEqual([]);
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
      Reflect.deleteProperty(document.documentElement, 'scrollHeight');
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      vi.restoreAllMocks();
    });

    async function open(routes?: Routes): Promise<RouterTestingHarness> {
      const harness = await render(SidebarTestPage, '/', routes);
      const button = menuButton(harness);
      button.focus();
      button.click();
      await settle(harness);
      return harness;
    }

    it('opens a modal dialog named "Navigation" with the sidebar inside and focus on Close', async () => {
      const harness = await open();
      const sheet = dialog();
      expect(sheet).not.toBeNull();
      expect(sheet?.getAttribute('aria-modal')).toBe('true');
      expect(sheet?.getAttribute('aria-label')).toBe('Navigation');
      expect(sheet?.querySelector('nav[aria-label="Test organization"]')).not.toBeNull();
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
