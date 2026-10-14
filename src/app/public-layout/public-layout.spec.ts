import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { PublicLayout } from './public-layout';

// The public layout (design/mockups/300-public-site-navigation.html and the frame of
// 300-public-site-organization.html): a light top bar, no sidebar, and a footer.

@Component({
  selector: 'app-public-layout-test-page',
  imports: [PublicLayout],
  template: `
    <app-public-layout>
      <h1>Page heading</h1>
    </app-public-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestPage {}

describe('PublicLayout', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;

  /** Opens `url` in the layout; `session` null is signed out. */
  async function open(url = '/organizations/gulf-coast', session: { id: string } | null = null) {
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '**', component: TestPage }]),
      ],
    });
    auth.emitSession(session);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    return harness.fixture.nativeElement as HTMLElement;
  }

  const labels = (links: Iterable<Element>) => [...links].map((a) => a.textContent.trim());
  const classes = (element: Element | null | undefined) => element?.className.split(/\s+/) ?? [];

  describe('landmarks', () => {
    it('has one header holding the top bar, one main#main with tabindex -1, and one footer', async () => {
      const page = await open();

      expect(page.querySelectorAll('header')).toHaveLength(1);
      expect(page.querySelectorAll('footer')).toHaveLength(1);
      const mains = page.querySelectorAll('main');
      expect(mains).toHaveLength(1);
      expect(mains[0].id).toBe('main');
      expect(mains[0].getAttribute('tabindex')).toBe('-1');
      // The top bar is the header's content; the footer and main are outside it.
      expect(page.querySelector('header')?.contains(page.querySelector('a[href="/"]'))).toBe(true);
      expect(page.querySelector('header')?.contains(mains[0])).toBe(false);
      expect(page.querySelector('footer')?.contains(mains[0])).toBe(false);
    });

    it('puts the footer links in one navigation landmark named "Footer", inside the footer', async () => {
      const page = await open();

      const navs = page.querySelectorAll('nav');
      expect(navs).toHaveLength(1);
      expect(navs[0].getAttribute('aria-label')).toBe('Footer');
      expect(page.querySelector('footer')?.contains(navs[0])).toBe(true);
      expect(page.querySelector('header nav')).toBeNull();
    });

    it('projects the page into main, after the header and before the footer', async () => {
      const page = await open();

      const main = page.querySelector('main')!;
      expect(main.querySelector('h1')?.textContent).toBe('Page heading');
      expect(
        page.querySelector('header')!.compareDocumentPosition(main) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        main.compareDocumentPosition(page.querySelector('footer')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe('top bar', () => {
    it('starts with the skip link to #main, then "Omni League" to the home page, then "Sign in"', async () => {
      const page = await open('/organizations/gulf-coast?ott=SECRET');

      const links = [...page.querySelectorAll('a')];
      expect(links[0].textContent.trim()).toBe('Skip to main content');
      // The router's current URL with the fragment set; as in the app shell, a server render
      // leaves the query string out (public-layout.server.spec.ts).
      expect(links[0].getAttribute('href')).toBe('/organizations/gulf-coast?ott=SECRET#main');
      const header = page.querySelector('header')!;
      expect(labels(header.querySelectorAll('a'))).toEqual(['Omni League', 'Sign in']);
      expect(header.querySelector('a')?.getAttribute('href')).toBe('/');
      expect(header.querySelector('a[href^="/sign-in"]')?.getAttribute('href')).toBe(
        '/sign-in?returnTo=%2Forganizations%2Fgulf-coast%3Fott%3DSECRET',
      );
    });

    it('has no menu button, no sidebar, and no dialog', async () => {
      const page = await open();

      expect(page.querySelector('button')).toBeNull();
      expect(page.querySelector('aside')).toBeNull();
      expect(page.querySelector('[aria-label="Open navigation"]')).toBeNull();
      expect(page.querySelector('[role="dialog"]')).toBeNull();
    });

    it('is light: a card background and a border, 64px tall, sticky', async () => {
      const page = await open();

      const header = page.querySelector('header');
      expect(classes(header)).toEqual(
        expect.arrayContaining(['sticky', 'top-0', 'z-30', 'border-b', 'border-border', 'bg-card']),
      );
      expect(classes(header?.firstElementChild)).toEqual(
        expect.arrayContaining(['mx-auto', 'h-16', 'max-w-6xl']),
      );
    });

    it('keeps its controls at least 44px tall on a phone: min-h-11 on the brand and "Sign in"', async () => {
      const page = await open();

      expect(classes(page.querySelector('header a[href="/"]'))).toContain('min-h-11');
      const signIn = page.querySelector('header a[href^="/sign-in"]');
      expect(classes(signIn?.closest('app-top-bar-account')?.parentElement)).toContain(
        '[&_a]:min-h-11',
      );
    });

    it('shows the account link in place of "Sign in" for a signed-in visitor, after hydration', async () => {
      const page = await open('/organizations/gulf-coast', { id: 'u1' });
      TestBed.inject(AuthService).onChange(true);
      TestBed.tick();
      convex.activeSubscriptions.find((s) => s.name === 'users:me')?.emit({ name: 'Tasha Greene' });
      await harness.fixture.whenStable();

      const header = page.querySelector('header')!;
      expect(header.querySelector('a[href^="/sign-in"]')).toBeNull();
      expect(header.querySelector('a[href="/app"]')?.textContent).toContain('Tasha Greene');
    });
  });

  describe('offline note', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sits directly below the top bar, as a status region, before main', async () => {
      const page = await open();

      const region = page.querySelector('header')?.nextElementSibling;
      expect(region?.tagName).toBe('APP-OFFLINE-NOTE');
      expect(region?.getAttribute('role')).toBe('status');
      expect(region?.nextElementSibling?.tagName).toBe('MAIN');
    });

    it('shows the note while offline, stuck below the 65px bar (the shell’s is 56px)', async () => {
      const page = await open();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();

      expect(page.querySelector('header + [role="status"] [data-offline-note]')).not.toBeNull();
      expect(classes(page.querySelector('app-offline-note')?.parentElement)).toContain(
        '[--top-bar-h:calc(4rem+1px)]',
      );
    });
  });

  describe('footer', () => {
    it('shows the brand, the tagline, the two link groups, and the copyright', async () => {
      const page = await open();

      const footer = page.querySelector('footer')!;
      expect(footer.textContent).toContain('Omni League');
      expect(footer.textContent).toContain(
        'Recreational leagues for beach volleyball, soccer, and softball.',
      );
      expect(footer.textContent).toContain('© 2026 Omni League');
      expect(labels(footer.querySelectorAll('nav h2'))).toEqual(['Players', 'Organizers']);
    });

    it('links Your account, Create an organization, and Sign in to manage', async () => {
      const page = await open();

      const links = [...page.querySelectorAll('footer nav a')];
      expect(links.map((a) => [a.textContent.trim(), a.getAttribute('href')])).toEqual([
        ['Your account', '/app'],
        ['Create an organization', '/app/organizations/new'],
        ['Sign in to manage', '/sign-in?returnTo=%2Fapp'],
      ]);
    });

    it('keeps its links at least 44px tall on a phone', async () => {
      const page = await open();

      for (const link of page.querySelectorAll('footer a')) {
        expect(classes(link), link.textContent).toContain('min-h-11');
      }
    });
  });
});
