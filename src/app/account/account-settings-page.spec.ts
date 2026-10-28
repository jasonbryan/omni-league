import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { AccountSettingsPage } from './account-settings-page';

@Component({ template: 'home' })
class Home {}

describe('AccountSettingsPage', () => {
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
          { path: 'app/account', component: AccountSettingsPage },
          { path: '', component: Home },
        ]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/app/account');
    return harness.routeNativeElement!;
  }

  const meSubscriptions = () => convex.activeSubscriptions.filter((s) => s.name === 'users:me');
  const emitMe = (me: { name: string; email?: string }) => {
    for (const sub of meSubscriptions()) sub.emit(me);
  };
  const signOutButton = (page: HTMLElement) =>
    [...page.querySelectorAll('button')].find((b) => b.textContent?.includes('Sign'));
  const accepted = () => {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
  };
  const settle = async () => {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  };

  it('asks users.me only once Convex has accepted the token', async () => {
    const page = await open();
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Account settings');

    accepted();
    // The page's own query and the top bar's account link.
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      ['users:me', {}],
      ['users:me', {}],
    ]);
  });

  it('shows the name and email under one h1, with Sign out', async () => {
    const page = await open();
    accepted();
    emitMe({ name: 'Maya Okafor', email: 'maya@example.test' });
    await harness.fixture.whenStable();

    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Account settings');
    const text = page.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Maya Okafor');
    expect(text).toContain('maya@example.test');
    expect(page.querySelector('span[aria-hidden="true"]')?.textContent?.trim()).toBe('MO');
    expect(page.querySelector('main [role="status"]')).toBeNull();
    expect(signOutButton(page)?.textContent?.trim()).toBe('Sign out');
  });

  it('shows the name alone when the token has no email', async () => {
    const page = await open();
    accepted();
    emitMe({ name: 'Maya Okafor' });
    await harness.fixture.whenStable();

    expect(page.textContent).toContain('Maya Okafor');
    expect(page.textContent).not.toContain('@');
  });

  it('shows a skeleton with a status until users.me answers, and Sign out meanwhile', async () => {
    const page = await open();
    accepted();
    await harness.fixture.whenStable();

    const status = page.querySelector('main [role="status"]');
    expect(status?.textContent?.trim()).toBe('Loading your account details.');
    expect(status?.classList.contains('sr-only')).toBe(true);
    expect(signOutButton(page)?.textContent?.trim()).toBe('Sign out');
  });

  it('shows the skeleton, not an answer, while the token is not yet accepted', async () => {
    const page = await open();
    TestBed.tick();
    await harness.fixture.whenStable();

    expect(page.querySelector('main [role="status"]')).not.toBeNull();
    expect(convex.subscriptions).toEqual([]);
  });

  it('shows an alert with Try again when users.me fails, which asks again, and keeps Sign out', async () => {
    const page = await open();
    accepted();
    meSubscriptions()[0]?.fail(new Error('down'));
    await harness.fixture.whenStable();

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'Your account details could not be loaded.',
    );
    expect(signOutButton(page)?.textContent?.trim()).toBe('Sign out');

    const tryAgain = [...page.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Try again',
    );
    tryAgain!.click();
    await settle();
    expect(convex.subscriptions.filter((s) => s.name === 'users:me')).toHaveLength(3);
    expect(meSubscriptions()).toHaveLength(2);
    expect(page.querySelector('[role="alert"]')).toBeNull();

    emitMe({ name: 'Maya Okafor', email: 'maya@example.test' });
    await harness.fixture.whenStable();
    expect(page.textContent).toContain('maya@example.test');
  });

  it('Sign out is an outline button that signs out and goes to /', async () => {
    const page = await open();
    accepted();
    emitMe({ name: 'Maya Okafor', email: 'maya@example.test' });
    await harness.fixture.whenStable();

    const button = signOutButton(page)!;
    expect(button.getAttribute('type')).toBe('button');
    expect([...button.classList].sort()).toEqual(
      buttonVariants({ variant: 'outline', size: 'lg' }).split(' ').sort(),
    );
    button.click();
    await settle();

    expect(auth.signOuts).toBe(1);
    expect(TestBed.inject(AuthService).signedIn()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('reads "Signing out…" while the request is pending, and a second press does nothing', async () => {
    const page = await open();
    accepted();
    emitMe({ name: 'Maya Okafor' });
    await harness.fixture.whenStable();

    auth.holdSignOut = true;
    const button = signOutButton(page)!;
    button.click();
    button.click();
    await harness.fixture.whenStable();
    expect(button.textContent?.trim()).toBe('Signing out…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(auth.signOuts).toBe(1);

    auth.releaseSignOut();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('still signs this browser out and goes to / when the sign-out request is rejected', async () => {
    const page = await open();
    accepted();
    emitMe({ name: 'Maya Okafor' });
    await harness.fixture.whenStable();

    auth.signOutRejects = true;
    signOutButton(page)!.click();
    await settle();

    expect(auth.signOuts).toBe(1);
    expect(TestBed.inject(AuthService).signedIn()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/');
  });
});
