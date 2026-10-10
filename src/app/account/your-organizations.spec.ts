import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { YourOrganizations, organizationInitials } from './your-organizations';

// "Your organizations" on /app (#64), design/mockups/64-create-organization.html states 1 to 4.

@Component({
  imports: [YourOrganizations],
  template: '<app-your-organizations />',
})
class Host {}

const COASTAL = { name: 'Coastal Bend Rec Club', slug: 'coastal-bend-rec-club', role: 'orgAdmin' };
const MUSTANG = {
  name: 'Mustang Island Beach Volleyball',
  slug: 'mustang-island-beach-volleyball',
  role: 'orgAdmin',
};
const RIVERBEND = {
  name: 'Riverbend Softball Association',
  slug: 'riverbend-softball-association',
  role: 'leagueOrganizer',
};

describe('YourOrganizations', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let section: HTMLElement;

  async function open() {
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '', component: Host }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/');
    section = harness.routeNativeElement!.querySelector('section')!;
  }

  /** Convex accepts the token, then the query answers with `rows`. */
  async function answer(rows: unknown): Promise<FakeSubscription> {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    const subscription = convex.activeSubscriptions[0];
    subscription.emit(rows);
    await harness.fixture.whenStable();
    return subscription;
  }

  const rows = () => [...section.querySelectorAll('li')];
  const link = (row: Element, text: string) =>
    [...row.querySelectorAll('a')].find((a) => a.textContent?.includes(text));
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();

  it('asks organizations.listMine with no argument, and only once Convex has accepted the token', async () => {
    await open();
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      ['organizations:listMine', {}],
    ]);
  });

  it('loading (state 1): the heading, two placeholder rows, and a polite status', async () => {
    await open();
    expect(section.getAttribute('aria-labelledby')).toBe('organizations-heading');
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Your organizations');
    expect(section.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Loading your organizations.',
    );
    expect(section.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(2);
    expect(section.querySelector('a')).toBeNull();
  });

  it('none (state 2): the empty state with the Create an organization button', async () => {
    await open();
    await answer([]);
    expect(section.querySelector('[role="status"]')).toBeNull();
    expect(text(section.querySelector('p.font-medium'))).toBe('No organizations yet');
    expect(text(section)).toContain(
      'Create one to run your leagues on Omni League, or ask an org admin to invite you to theirs.',
    );
    const links = [...section.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/app/organizations/new');
    expect(text(links[0])).toBe('Create an organization');
    expect([...links[0].classList].sort()).toEqual(
      buttonVariants({ size: 'lg' }).split(' ').sort(),
    );
    expect(section.querySelector('ul')).toBeNull();
  });

  it('one organization (state 3): a row with initials, name, role, and Public page, and no Manage', async () => {
    await open();
    await answer([COASTAL]);
    const header = section.querySelector('div.border-b');
    expect(text(header)).toBe('Your organizationsCreate an organization');
    expect(header?.querySelector('a')?.getAttribute('href')).toBe('/app/organizations/new');
    expect([...header!.querySelector('a')!.classList].sort()).toEqual(
      buttonVariants({ variant: 'outline', size: 'lg' }).split(' ').sort(),
    );

    expect(section.querySelector('ul')?.getAttribute('role')).toBe('list');
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(text(row.querySelector('span[aria-hidden="true"]'))).toBe('CB');
    expect(text(row.querySelector('h3'))).toBe('Coastal Bend Rec Club');
    expect(text(row.querySelector('p'))).toBe('Org admin');
    const publicPage = link(row, 'Public page')!;
    expect(publicPage.getAttribute('href')).toBe('/organizations/coastal-bend-rec-club');
    expect(text(publicPage)).toBe('Public page: Coastal Bend Rec Club');
    expect(publicPage.querySelector('.sr-only')?.textContent).toBe(': Coastal Bend Rec Club');
    // #65 adds Manage.
    expect(link(row, 'Manage')).toBeUndefined();
    expect(row.querySelectorAll('a')).toHaveLength(1);
  });

  it('several organizations (state 4): one row each, in the order the query gives, with the role names', async () => {
    await open();
    await answer([COASTAL, MUSTANG, RIVERBEND]);
    expect(rows().map((row) => text(row.querySelector('h3')))).toEqual([
      'Coastal Bend Rec Club',
      'Mustang Island Beach Volleyball',
      'Riverbend Softball Association',
    ]);
    expect(rows().map((row) => text(row.querySelector('p')))).toEqual([
      'Org admin',
      'Org admin',
      'League organizer',
    ]);
    expect(rows().map((row) => text(row.querySelector('span[aria-hidden="true"]')))).toEqual([
      'CB',
      'MI',
      'RS',
    ]);
    expect(rows().map((row) => link(row, 'Public page')?.getAttribute('href'))).toEqual([
      '/organizations/coastal-bend-rec-club',
      '/organizations/mustang-island-beach-volleyball',
      '/organizations/riverbend-softball-association',
    ]);
  });

  it('follows the live query: a new organization appears without a reload', async () => {
    await open();
    const subscription = await answer([]);
    expect(rows()).toHaveLength(0);
    subscription.emit([COASTAL]);
    await harness.fixture.whenStable();
    expect(rows()).toHaveLength(1);
  });

  it('a failed query shows the form alert pattern, not an endless placeholder', async () => {
    await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    convex.activeSubscriptions[0]?.fail(new Error('Server Error'));
    await harness.fixture.whenStable();
    expect(section.querySelector('[role="status"]')).toBeNull();
    const alert = section.querySelector('[role="alert"]');
    expect(text(alert)).toBe(
      'Your organizations could not be loaded. Check your connection and try again.',
    );
    expect(alert?.textContent).not.toContain('Server Error');
  });
});

describe('organizationInitials', () => {
  it.each([
    ['Coastal Bend Rec Club', 'CB'],
    ['Mustang Island Beach Volleyball', 'MI'],
    ['Gulf Coast Sport & Social', 'GC'],
    ['Riverbend', 'R'],
    ['  élan   vital ', 'ÉV'],
    ['', ''],
  ])('%j gives %j', (name, initials) => {
    expect(organizationInitials(name)).toBe(initials);
  });
});
