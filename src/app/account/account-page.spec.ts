import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { AccountPage } from './account-page';

@Component({ template: 'home' })
class Home {}

describe('AccountPage', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;

  async function open() {
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([
          { path: 'app', component: AccountPage },
          { path: '', component: Home },
        ]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/app');
    return harness.routeNativeElement!;
  }

  it('asks organizations.listMine only once Convex has accepted the token', async () => {
    const page = await open();
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Home');

    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    // The page's list and the home sidebar's.
    expect(
      convex.activeSubscriptions.filter((s) => s.name === 'organizations:listMine'),
    ).toHaveLength(2);
  });

  it('has one h1, "Home", and no Sign out or signed-in account panel', async () => {
    const page = await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    await harness.fixture.whenStable();

    expect([...page.querySelectorAll('h1')].map((h) => h.textContent?.trim())).toEqual(['Home']);
    expect(page.querySelector('section[aria-label="Signed-in account"]')).toBeNull();
    expect(
      [...page.querySelectorAll('main button')].filter((b) => b.textContent?.includes('Sign out')),
    ).toEqual([]);
    expect(page.querySelector('main')?.textContent).not.toContain('Signed in as');
  });

  it('links to the notifications page from a Notifications panel, named Manage notifications', async () => {
    const page = await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    await harness.fixture.whenStable();

    const panel = page.querySelector('section[aria-labelledby="app-notifications-heading"]');
    expect(panel?.querySelector('h2')?.textContent?.trim()).toBe('Notifications');
    expect(panel?.textContent).toContain('Game reminders, schedule changes, and score updates.');
    const link = panel?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/app/notifications');
    expect(link?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Manage notifications');
    expect(link?.querySelector('.sr-only')?.textContent).toBe(' notifications');
  });

  it('shows "Your organizations"', async () => {
    const page = await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    convex.activeSubscriptions
      .find((s) => s.name === 'organizations:listMine')
      ?.emit([
        {
          name: 'Coastal Bend Rec Club',
          slug: 'coastal-bend-rec-club',
          role: 'orgAdmin',
          leagues: [],
        },
      ]);
    await harness.fixture.whenStable();

    const sections = [...page.querySelectorAll('main section')];
    expect(sections.map((s) => s.getAttribute('aria-labelledby'))).toEqual([
      'organizations-heading',
      'app-notifications-heading',
    ]);
    expect(sections[0]?.querySelector('h3')?.textContent?.trim()).toBe('Coastal Bend Rec Club');
  });
});
