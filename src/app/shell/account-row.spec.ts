import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { AccountRow } from './account-row';

@Component({
  selector: 'app-account-row-test-page',
  imports: [AccountRow],
  template: `
    <app-account-row id="row" />
    <app-account-row id="bar" variant="initials" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class AccountRowTestPage {}

describe('AccountRow', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;

  async function open(url = '/app') {
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '**', component: AccountRowTestPage }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function authenticated() {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    await harness.fixture.whenStable();
  }

  async function answer(me: { name: string; email?: string } | null) {
    for (const sub of meSubscriptions()) sub.emit(me);
    await harness.fixture.whenStable();
  }

  async function fail() {
    for (const sub of meSubscriptions()) sub.fail(new Error('boom'));
    await harness.fixture.whenStable();
  }

  const meSubscriptions = () => convex.activeSubscriptions.filter((s) => s.name === 'users:me');

  const row = (page: HTMLElement) => page.querySelector<HTMLElement>('#row')!;
  const bar = (page: HTMLElement) => page.querySelector<HTMLElement>('#bar')!;
  const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

  it('asks users.me only once Convex has accepted the token', async () => {
    await open();
    expect(convex.subscriptions).toEqual([]);
    await authenticated();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      ['users:me', {}],
      ['users:me', {}],
    ]);
  });

  it('shows a skeleton and no link, name, or email until users.me answers', async () => {
    const page = await open();
    expect(row(page).querySelector('a')).toBeNull();
    expect(row(page).querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(row(page).querySelector('[class*="animate-pulse"]')).not.toBeNull();
    await authenticated();
    expect(row(page).querySelector('a')).toBeNull();
    expect(bar(page).querySelector('a')).toBeNull();
  });

  describe('the sidebar foot', () => {
    it('links to /app/account with initials, name, and email', async () => {
      const page = await open();
      await authenticated();
      await answer({ name: 'Maya Okafor', email: 'maya@example.com' });
      const link = row(page).querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe('/app/account');
      expect(link.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('MO');
      expect([...link.querySelectorAll('.block')].map((span) => span.textContent?.trim())).toEqual([
        'Maya Okafor',
        'maya@example.com',
      ]);
      expect(link.querySelector('.sr-only')?.textContent).toBe('Account settings: ');
      expect(link.hasAttribute('aria-current')).toBe(false);
    });

    it('leaves the email out when the token has none', async () => {
      const page = await open();
      await authenticated();
      await answer({ name: 'Maya Okafor' });
      expect(squash(row(page).textContent)).toBe('MOAccount settings: Maya Okafor');
    });

    it('is the current page on /app/account only', async () => {
      const page = await open('/app/account');
      await authenticated();
      await answer({ name: 'Maya Okafor' });
      expect(row(page).querySelector('a')?.getAttribute('aria-current')).toBe('page');
      TestBed.resetTestingModule();

      const other = await open('/app/account/extra');
      await authenticated();
      await answer({ name: 'Maya Okafor' });
      expect(row(other).querySelector('a')?.hasAttribute('aria-current')).toBe(false);
    });

    it('is named "Account settings" with no initials, name, or email when users.me fails', async () => {
      const page = await open();
      await authenticated();
      await fail();
      const link = row(page).querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe('/app/account');
      expect(squash(link.textContent)).toBe('Account settings');
      expect(link.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('');
    });

    it('falls back the same way when the user has no record', async () => {
      const page = await open();
      await authenticated();
      await answer(null);
      expect(squash(row(page).textContent)).toBe('Account settings');
    });
  });

  describe('the slim bar', () => {
    it('is a link to /app/account named "Account settings: <name>", with only the initials on screen', async () => {
      const page = await open();
      await authenticated();
      await answer({ name: 'Maya Okafor', email: 'maya@example.com' });
      const link = bar(page).querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe('/app/account');
      expect(link.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('MO');
      expect(squash(link.textContent)).toBe('MOAccount settings: Maya Okafor');
      expect(link.textContent).not.toContain('maya@example.com');
    });

    it('is named "Account settings" when users.me fails', async () => {
      const page = await open();
      await authenticated();
      await fail();
      const link = bar(page).querySelector<HTMLAnchorElement>('a')!;
      expect(squash(link.textContent)).toBe('Account settings');
    });
  });

  it("shows the next user's name after the session changes hands, never the first user's", async () => {
    const page = await open();
    await authenticated();
    await answer({ name: 'Alice Ames', email: 'alice@example.com' });
    expect(row(page).textContent).toContain('alice@example.com');

    TestBed.inject(AuthService).onChange(false);
    TestBed.tick();
    await harness.fixture.whenStable();
    expect(row(page).textContent).not.toContain('alice@example.com');
    expect(row(page).textContent).not.toContain('Alice Ames');
    expect(row(page).querySelector('a')).toBeNull();
  });
});
