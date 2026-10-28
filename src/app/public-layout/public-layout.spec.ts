import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { PublicLayout } from './public-layout';

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

  describe('landmarks', () => {
    it('has one header holding the top bar, one main#main with tabindex -1, and one footer', async () => {
      const page = await open();

      expect(page.querySelectorAll('header')).toHaveLength(1);
      expect(page.querySelectorAll('footer')).toHaveLength(1);
      const mains = page.querySelectorAll('main');
      expect(mains).toHaveLength(1);
      expect(mains[0].id).toBe('main');
      expect(mains[0].getAttribute('tabindex')).toBe('-1');
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
      expect(links[0].getAttribute('href')).toBe('/organizations/gulf-coast?ott=SECRET#main');
      const header = page.querySelector('header')!;
      expect(labels(header.querySelectorAll('a'))).toEqual([
        'Omni League',
        'Find a league',
        'Sign in',
      ]);
      expect(header.querySelector('a')?.getAttribute('href')).toBe('/');
      expect(header.querySelector('a[href^="/sign-in"]')?.getAttribute('href')).toBe(
        '/sign-in?returnTo=%2Forganizations%2Fgulf-coast%3Fott%3DSECRET',
      );
    });

    describe('Find a league', () => {
      const search = (page: HTMLElement) =>
        page.querySelector<HTMLFormElement>('header form[role="search"]');
      const phoneLink = (page: HTMLElement) =>
        page.querySelector<HTMLAnchorElement>('header a[href="/leagues"]');

      it('puts a search form named "Find a league" after the brand link, submitting q to /leagues by GET', async () => {
        const page = await open();

        const form = search(page);
        expect(form?.getAttribute('aria-label')).toBe('Find a league');
        expect(form?.getAttribute('method')).toBe('get');
        expect(form?.getAttribute('action')).toBe('/leagues');
        const label = form?.querySelector('label');
        const field = form?.querySelector('input');
        expect(label?.textContent.trim()).toBe('Find a league');
        expect(label?.htmlFor).toBe(field?.id);
        expect(field?.getAttribute('name')).toBe('q');
        expect(field?.getAttribute('type')).toBe('search');
        expect(field?.getAttribute('placeholder')).toBe('Find a league');
        expect(form?.querySelector('button')).toBeNull();
        expect(
          page.querySelector('header a')!.compareDocumentPosition(form!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      it('shows the field from 768px and the link below it, each hidden at the other size', async () => {
        const page = await open();

        expect(search(page)?.classList.contains('hidden')).toBe(true);
        expect(search(page)?.classList.contains('md:block')).toBe(true);
        expect(phoneLink(page)?.classList.contains('md:hidden')).toBe(true);
      });

      it('links to /leagues with the name "Find a league" in a target 44px square', async () => {
        const page = await open();

        const link = phoneLink(page);
        expect(link?.textContent.trim()).toBe('Find a league');
        expect(link?.classList.contains('size-11')).toBe(true);
        expect(link?.querySelector('ng-icon')?.getAttribute('aria-hidden')).toBe('true');
      });

      it.each(['/leagues', '/leagues?q=coed'])(
        'shows neither on %s, and the account side moves to the right edge',
        async (url) => {
          const page = await open(url);

          expect(search(page)).toBeNull();
          expect(phoneLink(page)).toBeNull();
          expect(labels(page.querySelectorAll('header a'))).toEqual(['Omni League', 'Sign in']);
          expect(
            page.querySelector('app-top-bar-account')?.parentElement?.classList.contains('ms-auto'),
          ).toBe(true);
        },
      );

      it('keeps the field on a path that only starts with /leagues', async () => {
        const page = await open('/leagues/x');

        expect(search(page)).not.toBeNull();
      });

      it('goes to /leagues?q= with the typed words through the router, not a page load', async () => {
        const page = await open();
        const field = search(page)!.querySelector('input')!;
        field.value = '  coed ';
        field.dispatchEvent(new Event('input'));
        const submit = new Event('submit', { cancelable: true });
        search(page)!.dispatchEvent(submit);
        await harness.fixture.whenStable();

        expect(submit.defaultPrevented).toBe(true);
        expect(TestBed.inject(Router).url).toBe('/leagues?q=coed');
      });

      it('goes to /leagues without a query when the field is empty', async () => {
        const page = await open();
        search(page)!.dispatchEvent(new Event('submit', { cancelable: true }));
        await harness.fixture.whenStable();

        expect(TestBed.inject(Router).url).toBe('/leagues');
      });
    });

    it('has no menu button, no sidebar, and no dialog', async () => {
      const page = await open();

      expect(page.querySelector('button')).toBeNull();
      expect(page.querySelector('aside')).toBeNull();
      expect(page.querySelector('[aria-label="Open navigation"]')).toBeNull();
      expect(page.querySelector('[role="dialog"]')).toBeNull();
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

    it('shows the note while offline', async () => {
      const page = await open();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();

      expect(page.querySelector('header + [role="status"] [data-offline-note]')).not.toBeNull();
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

    it('links Find a league, Your account, Create an organization, and Sign in to manage', async () => {
      const page = await open();

      const links = [...page.querySelectorAll('footer nav a')];
      expect(links.map((a) => [a.textContent.trim(), a.getAttribute('href')])).toEqual([
        ['Find a league', '/leagues'],
        ['Your account', '/app'],
        ['Create an organization', '/app/organizations/new'],
        ['Sign in to manage', '/sign-in?returnTo=%2Forganizations%2Fgulf-coast'],
      ]);
    });

    it.each([
      [
        '/organizations/gulf-coast/leagues/x?tab=a#top',
        '%2Forganizations%2Fgulf-coast%2Fleagues%2Fx%3Ftab%3Da%23top',
      ],
      ['/', '%2F'],
      ['/sign-up?returnTo=%2Fleagues%2Fx%2Fregister', '%2Fleagues%2Fx%2Fregister'],
      ['/sign-up', '%2Fapp'],
      ['/sign-in?returnTo=%2Fleagues%2Fx%2Fregister', '%2Fleagues%2Fx%2Fregister'],
      ['/sign-in', '%2Fapp'],
    ])('on %s "Sign in to manage" returns to %s after sign-in', async (url, returnTo) => {
      const page = await open(url);

      const link = [...page.querySelectorAll('footer nav a')].find(
        (a) => a.textContent.trim() === 'Sign in to manage',
      );
      expect(link?.getAttribute('href')).toBe(`/sign-in?returnTo=${returnTo}`);
    });
  });
});
