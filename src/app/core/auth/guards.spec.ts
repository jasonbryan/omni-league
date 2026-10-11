import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { redirectSignedIn, requireSignedIn } from './guards';
import { FakeAuthClient, provideFakeAuthClient } from './testing/fake-auth-client';

@Component({ template: 'page' })
class Page {}

describe('auth guards', () => {
  let client: FakeAuthClient;

  async function setup(session: { id: string } | null) {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(client),
        provideRouter([
          { path: '', component: Page },
          { path: 'sign-up', component: Page, canActivate: [redirectSignedIn] },
          { path: 'sign-in', component: Page, canActivate: [redirectSignedIn] },
          { path: 'app', component: Page, canActivate: [requireSignedIn] },
          { path: 'leagues/x/register', component: Page },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    client.emitSession(session);
    return { harness, router: TestBed.inject(Router) };
  }

  describe('requireSignedIn (/app)', () => {
    it('sends a signed-out visitor to /sign-in?returnTo=/app', async () => {
      const { harness, router } = await setup(null);
      await harness.navigateByUrl('/app');
      expect(router.url).toBe('/sign-in?returnTo=%2Fapp');
      expect(router.parseUrl(router.url).queryParams).toEqual({ returnTo: '/app' });
    });

    it('lets a signed-in visitor in', async () => {
      const { harness, router } = await setup({ id: 's1' });
      await harness.navigateByUrl('/app');
      expect(router.url).toBe('/app');
    });

    it('waits for the session store before deciding', async () => {
      client = new FakeAuthClient();
      TestBed.configureTestingModule({
        providers: [
          provideFakeAuthClient(client),
          provideRouter([
            { path: 'sign-in', component: Page },
            { path: 'app', component: Page, canActivate: [requireSignedIn] },
          ]),
        ],
      });
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/app');
      await new Promise((resolve) => setTimeout(resolve, 0));
      client.emitSession({ id: 's1' });
      await navigation;
      expect(TestBed.inject(Router).url).toBe('/app');
    });
  });

  describe.each(['/sign-up', '/sign-in'])('redirectSignedIn (%s)', (page) => {
    it('shows the page to a signed-out visitor', async () => {
      const { harness, router } = await setup(null);
      await harness.navigateByUrl(`${page}?returnTo=%2Fleagues%2Fx%2Fregister`);
      expect(router.url).toBe(`${page}?returnTo=%2Fleagues%2Fx%2Fregister`);
    });

    it.each([
      ['', '/app'],
      ['?returnTo=%2Fapp', '/app'],
      ['?returnTo=%2Fleagues%2Fx%2Fregister', '/leagues/x/register'],
      ['?returnTo=%2F%2Fevil.example%2Fx', '/app'],
      ['?returnTo=https%3A%2F%2Fevil.example', '/app'],
      ['?returnTo=%2F%5Cevil.example', '/app'],
    ])('sends a signed-in visitor from %s%s to %s', async (query, to) => {
      const from = `${page}${query}`;
      const { harness, router } = await setup({ id: 's1' });
      await harness.navigateByUrl(from);
      expect(router.url).toBe(to);
    });
  });
});
