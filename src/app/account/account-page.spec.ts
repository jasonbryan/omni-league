import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { AccountPage, initialsOf } from './account-page';

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

  const emitMe = () => {
    for (const sub of convex.activeSubscriptions.filter((s) => s.name === 'users:me')) {
      sub.emit({ name: 'Maya Okafor' });
    }
  };

  it('asks users.me only once Convex has accepted the token', async () => {
    const page = await open();
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Your account');
    expect(page.querySelector('section[aria-label="Signed-in account"]')).toBeNull();

    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args]).sort()).toEqual([
      ['organizations:listMine', {}],
      ['users:me', {}],
      ['users:me', {}],
    ]);
  });

  it('shows "Signed in as <name>" with the initials, in the approved panel', async () => {
    const page = await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    emitMe();
    await harness.fixture.whenStable();

    const section = page.querySelector('section[aria-label="Signed-in account"]');
    expect(section?.getAttribute('aria-label')).toBe('Signed-in account');
    expect(section?.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Signed in asMaya Okafor',
    );
    expect(section?.querySelector('p > span')?.textContent?.trim()).toBe('Maya Okafor');
    const initials = section?.querySelector('span[aria-hidden="true"]');
    expect(initials?.textContent?.trim()).toBe('MO');
    expect(page.querySelectorAll('h1')).toHaveLength(1);
  });

  it('shows "Your organizations" below the account panel', async () => {
    const page = await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    emitMe();
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

    const sections = [...page.querySelectorAll('section')];
    expect(
      sections.map((s) => s.getAttribute('aria-label') ?? s.getAttribute('aria-labelledby')),
    ).toEqual(['Signed-in account', 'organizations-heading']);
    expect(sections[1]?.querySelector('h3')?.textContent?.trim()).toBe('Coastal Bend Rec Club');
  });

  it('Sign out deletes the session and goes to /', async () => {
    const page = await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    emitMe();
    await harness.fixture.whenStable();

    const button = [...page.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Sign out',
    );
    expect(button?.getAttribute('type')).toBe('button');
    expect([...(button?.classList ?? [])].sort()).toEqual(
      buttonVariants({ variant: 'outline', size: 'lg' }).split(' ').sort(),
    );
    button?.click();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();

    expect(auth.signOuts).toBe(1);
    expect(TestBed.inject(AuthService).signedIn()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/');
  });
});

describe('initialsOf', () => {
  it.each([
    ['Maya Okafor', 'MO'],
    ['  maya   de la cruz ', 'MC'],
    ['Prince', 'P'],
    ['Élodie Ånström', 'ÉÅ'],
    ['', ''],
  ])('%j gives %j', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
