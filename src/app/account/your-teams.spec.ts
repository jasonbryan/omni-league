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
import { BADGE_SECONDARY } from '../organizations/admin/field-classes';
import { buttonVariants } from '../ui/button/hlm-button';
import { YourTeams } from './your-teams';

@Component({
  imports: [YourTeams],
  template: '<app-your-teams />',
})
class Host {}

const SAND_SHARKS = {
  teamId: 'k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e',
  teamName: 'Sand Sharks',
  seasonName: 'Summer 2027',
  leagueName: 'Sunday Reverse Coed 4s',
  organizationName: 'Gulf Coast Sport & Social',
  role: 'captain',
};
const PAIR_OF_ACES = {
  teamId: 'k1aces',
  teamName: 'Pair of Aces',
  seasonName: 'Summer 2027',
  leagueName: 'Thursday Night Coed 2s',
  organizationName: 'Gulf Coast Sport & Social',
  role: 'player',
};
const BAYSIDE = {
  teamId: 'k1bayside',
  teamName: 'Bayside Strikers',
  seasonName: 'Spring 2027',
  leagueName: 'Coed 7v7 Rec',
  organizationName: 'Gulf Coast Sport & Social',
  role: 'guardian',
};
const RATTLERS = {
  teamId: 'k1rattlers',
  teamName: 'Riverbend Rattlers',
  seasonName: 'Spring 2027',
  leagueName: 'Wednesday Coed Slow-Pitch',
  organizationName: 'Riverbend Softball Association',
  role: 'coach',
};

describe('YourTeams', () => {
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

  async function answer(rows: unknown): Promise<FakeSubscription> {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    const subscription = convex.activeSubscriptions[0];
    subscription.emit(rows);
    await harness.fixture.whenStable();
    return subscription;
  }

  const rows = () => [...section.querySelectorAll('ul[role="list"] > li')];
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const badge = (row: Element) => row.querySelector('[data-slot="badge"]');

  it('asks teams.listMine with no argument, and only once Convex has accepted the token', async () => {
    await open();
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      ['teams:listMine', {}],
    ]);
  });

  it('loading (state 1): the heading, two placeholder rows, and a polite status', async () => {
    await open();
    expect(section.getAttribute('aria-labelledby')).toBe('teams-heading');
    expect(section.querySelector('h2#teams-heading')?.textContent?.trim()).toBe('Your teams');
    expect(section.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Loading your teams.',
    );
    expect(section.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(2);
    expect(section.querySelector('a')).toBeNull();
  });

  it('none (state 2): "No teams yet" and how to join, with no link', async () => {
    await open();
    await answer([]);
    expect(section.querySelector('[role="status"]')).toBeNull();
    expect(text(section.querySelector('p.font-medium'))).toBe('No teams yet');
    expect(text(section)).toContain(
      'To play, register a team or register as a free agent from a season’s page, or open the invite link your captain sent you.',
    );
    expect(section.querySelector('a')).toBeNull();
  });

  it('one team (state 3): name, season and league, organization, the Captain badge with a crown, and Team page', async () => {
    await open();
    await answer([SAND_SHARKS]);
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(text(row.querySelector('h3'))).toBe('Sand Sharks');
    expect([...row.querySelectorAll('p.text-muted-foreground')].map(text)).toEqual([
      'Summer 2027 · Sunday Reverse Coed 4s',
      'Gulf Coast Sport & Social',
    ]);
    expect(text(badge(row))).toBe('Captain');
    expect([...badge(row)!.classList].sort()).toEqual(BADGE_SECONDARY.split(' ').sort());
    expect(badge(row)?.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideCrown');
    const link = row.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/app/teams/k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e');
    expect(text(link)).toBe('Team page: Sand Sharks');
    expect(text(link.querySelector('.sr-only'))).toBe(': Sand Sharks');
    expect([...link.classList].sort()).toEqual(
      [
        ...buttonVariants({ variant: 'outline', size: 'md' }).split(' '),
        'flex-1',
        'sm:flex-none',
      ].sort(),
    );
  });

  it('several teams (state 4): one row each, in the order the query gives; Player and Guardian have no crown, and an unknown role has no badge', async () => {
    await open();
    await answer([SAND_SHARKS, PAIR_OF_ACES, BAYSIDE, RATTLERS]);
    expect(rows().map((row) => text(row.querySelector('h3')))).toEqual([
      'Sand Sharks',
      'Pair of Aces',
      'Bayside Strikers',
      'Riverbend Rattlers',
    ]);
    const [, aces, bayside, rattlers] = rows();
    expect(text(badge(aces))).toBe('Player');
    expect(badge(aces)?.querySelector('ng-icon')).toBeNull();
    expect(text(badge(bayside))).toBe('Guardian');
    expect(badge(bayside)?.querySelector('ng-icon')).toBeNull();
    expect(badge(rattlers)).toBeNull();
    expect(rattlers.textContent).not.toContain('coach');
    expect(rows().map((row) => row.querySelector('a')?.getAttribute('href'))).toEqual([
      '/app/teams/k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e',
      '/app/teams/k1aces',
      '/app/teams/k1bayside',
      '/app/teams/k1rattlers',
    ]);
  });

  it('encodes the team id in the link, so an id cannot change the path', async () => {
    await open();
    await answer([{ ...SAND_SHARKS, teamId: '../x?y' }]);
    expect(rows()[0].querySelector('a')?.getAttribute('href')).toBe('/app/teams/..%2Fx%3Fy');
  });

  it('follows the live query: a new team appears without a reload', async () => {
    await open();
    const subscription = await answer([]);
    expect(rows()).toHaveLength(0);
    subscription.emit([PAIR_OF_ACES]);
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
      'Your teams could not be loaded. Check your connection and try again.',
    );
    expect(alert?.textContent).not.toContain('Server Error');
  });
});
