import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { PlainTestPage } from './testing/test-pages';

describe('Top bar account area', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;

  async function open(url: string, session: { id: string } | null | undefined = null) {
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '**', component: PlainTestPage }]),
      ],
    });
    if (session !== undefined) auth.emitSession(session);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    return harness.fixture.nativeElement as HTMLElement;
  }

  const header = (page: HTMLElement) => page.querySelector('header')!;
  const signInLink = (page: HTMLElement) =>
    header(page).querySelector<HTMLAnchorElement>('a[href^="/sign-in"]');
  const accountLink = (page: HTMLElement) =>
    header(page).querySelector<HTMLAnchorElement>('a[href="/app"]');

  async function signedIn(name: string | null) {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    convex.activeSubscriptions.find((s) => s.name === 'users:me')?.emit(name ? { name } : null);
    await harness.fixture.whenStable();
  }

  describe('signed out', () => {
    it.each([
      ['/', '/sign-in?returnTo=%2F'],
      ['/organizations/gulf-coast', '/sign-in?returnTo=%2Forganizations%2Fgulf-coast'],
      [
        '/organizations/gulf-coast?tab=leagues#top',
        '/sign-in?returnTo=%2Forganizations%2Fgulf-coast%3Ftab%3Dleagues%23top',
      ],
      ['/no/such/page', '/sign-in?returnTo=%2Fno%2Fsuch%2Fpage'],
      [
        '/sign-up?returnTo=%2Fleagues%2Fx%2Fregister',
        '/sign-in?returnTo=%2Fleagues%2Fx%2Fregister',
      ],
      ['/sign-up', '/sign-in?returnTo=%2Fapp'],
    ])('on %s the Sign in link goes to %s', async (url, href) => {
      const page = await open(url);
      expect(signInLink(page)?.getAttribute('href')).toBe(href);
      expect(signInLink(page)?.textContent?.trim()).toBe('Sign in');
      expect(accountLink(page)).toBeNull();
    });

    it.each([
      '//evil.example/x',
      '/\\evil.example',
      'https://evil.example',
      '/..//evil.example/x',
      '',
    ])('on /sign-up an off-site returnTo %j is dropped', async (raw) => {
      const page = await open(`/sign-up?returnTo=${encodeURIComponent(raw)}`);
      expect(signInLink(page)?.getAttribute('href')).toBe('/sign-in?returnTo=%2Fapp');
    });

    it('is absent on /sign-in, whatever its query string', async () => {
      for (const url of ['/sign-in', '/sign-in?returnTo=%2Fapp', '/sign-in?x=1#top']) {
        const page = await open(url);
        expect(header(page).textContent).not.toContain('Sign in');
        expect(signInLink(page)).toBeNull();
        TestBed.resetTestingModule();
      }
    });

    it('is not absent on a path that only starts with sign-in', async () => {
      const page = await open('/sign-in-help');
      expect(signInLink(page)?.getAttribute('href')).toBe('/sign-in?returnTo=%2Fsign-in-help');
    });

    it('is after the brand and before nothing else, and is the only link besides the brand', async () => {
      const page = await open('/organizations/x');
      const links = [...header(page).querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(links).toEqual(['/', '/sign-in?returnTo=%2Forganizations%2Fx']);
    });

    it("draws the mockup's outline button pushed to the end", async () => {
      const page = await open('/organizations/x');
      const link = signInLink(page)!;
      expect([...link.classList].sort()).toEqual(
        `${buttonVariants({ variant: 'outline', size: 'md' })} ms-auto`.split(' ').sort(),
      );
      expect(link.getAttribute('data-slot')).toBe('button');
    });

    it('shows Sign in while the session is not known yet (the server render, and hydration)', async () => {
      const page = await open('/organizations/x', undefined);
      expect(signInLink(page)).not.toBeNull();
      expect(accountLink(page)).toBeNull();
      expect(convex.subscriptions).toEqual([]);
    });

    it('asks users.me for nobody', async () => {
      await open('/organizations/x');
      expect(convex.subscriptions).toEqual([]);
    });
  });

  describe('signed in', () => {
    it('swaps Sign in for the account link to /app, with initials and name', async () => {
      const page = await open('/organizations/x', { id: 's1' });
      await signedIn('Maya Okafor');
      expect(signInLink(page)).toBeNull();
      const link = accountLink(page)!;
      expect(link.getAttribute('href')).toBe('/app');
      expect(link.querySelector('span[aria-hidden="true"]')?.textContent?.trim()).toBe('MO');
      expect(link.querySelector('.truncate')?.textContent?.trim()).toBe('Maya Okafor');
      expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe('MOAccount: Maya Okafor');
      expect(link.querySelector('.sr-only')?.textContent).toBe('Account: ');
      expect(link.hasAttribute('aria-current')).toBe(false);
    });

    it("draws the mockup's ghost button, 144px wide at most on phones", async () => {
      const page = await open('/organizations/x', { id: 's1' });
      await signedIn('Maya Okafor');
      const link = accountLink(page)!;
      expect([...link.classList].sort()).toEqual(
        `${buttonVariants({ variant: 'ghost', size: 'md' })} ms-auto min-w-0 max-w-36 ps-1 md:max-w-64`
          .split(' ')
          .sort(),
      );
      expect(link.classList.contains('max-w-36')).toBe(true);
      expect(link.querySelector('.truncate')).not.toBeNull();
    });

    it('marks the link as the current page on /app', async () => {
      const page = await open('/app', { id: 's1' });
      await signedIn('Devon Reyes');
      expect(accountLink(page)?.getAttribute('aria-current')).toBe('page');
    });

    it('asks users.me only once Convex has accepted the token', async () => {
      const page = await open('/organizations/x', { id: 's1' });
      TestBed.tick();
      expect(convex.subscriptions).toEqual([]);
      expect(signInLink(page)).toBeNull();
      expect(accountLink(page)).toBeNull();
      TestBed.inject(AuthService).onChange(true);
      TestBed.tick();
      expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([['users:me', {}]]);
    });

    it('keeps a long name whole for assistive technology, and truncates it on screen', async () => {
      const page = await open('/organizations/x', { id: 's1' });
      await signedIn('Alejandra Castellanos-Whitfield');
      const link = accountLink(page)!;
      expect(link.querySelector('span[aria-hidden="true"]')?.textContent?.trim()).toBe('AC');
      expect(link.querySelector('.truncate')?.textContent?.trim()).toBe(
        'Alejandra Castellanos-Whitfield',
      );
    });

    it('goes back to Sign in when the session ends', async () => {
      const page = await open('/organizations/x', { id: 's1' });
      await signedIn('Maya Okafor');
      auth.emitSession(null);
      await harness.fixture.whenStable();
      expect(accountLink(page)).toBeNull();
      expect(signInLink(page)?.getAttribute('href')).toBe('/sign-in?returnTo=%2Forganizations%2Fx');
    });

    it('falls back to a plain "Account" link when the user has no record', async () => {
      const page = await open('/organizations/x', { id: 's1' });
      await signedIn(null);
      const link = accountLink(page)!;
      expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe('Account');
    });
  });
});
