import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Id } from '../../../../convex/_generated/dataModel';
import { AuthService } from '../../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { FakeConvexClient } from '../../core/data/convex/testing/fake-convex-client';
import {
  SIDEBAR_GROUP_LABEL,
  SIDEBAR_ICON,
  SIDEBAR_ICON_CURRENT,
  SIDEBAR_ROW,
  SIDEBAR_ROW_CURRENT,
} from '../../shell/sidebar-classes';
import { AdminSidebar } from './admin-sidebar';
import { COASTAL, COASTAL_LOCATIONS, Elsewhere, text } from './testing/admin-harness';

@Component({
  imports: [AdminSidebar],
  template: '<app-admin-sidebar [organization]="organization" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly organization = {
    ...COASTAL,
    organizationId: COASTAL.organizationId as Id<'organizations'>,
  };
}

const PUBLISHED_COUNT = 'leagues:publishedCount';
const DRAFT_COUNT = 'leagues:draftCount';
const LIST_LOCATIONS = 'locations:listForAdmin';
const STAFF_COUNT = 'memberships:staffCount';

async function render(url: string) {
  const convex = new FakeConvexClient();
  const auth = new FakeAuthClient();
  TestBed.configureTestingModule({
    providers: [
      provideFakeAuthClient(auth),
      { provide: CONVEX_CLIENT, useValue: convex },
      provideRouter([{ path: '**', component: Elsewhere }]),
    ],
  });
  auth.emitSession({ id: 's1' });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const authenticate = () => {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
  };
  const answer = async (name: string, value: unknown) => {
    convex.activeSubscriptions.find((s) => s.name === name)?.emit(value);
    await fixture.whenStable();
  };
  return {
    fixture,
    router,
    convex,
    authenticate,
    answer,
    host: fixture.nativeElement as HTMLElement,
  };
}

const BASE = `/app/organizations/${COASTAL.slug}`;
const classes = (element: Element) => [...element.classList].sort();
const tokens = (value: string) => value.split(' ').sort();
const links = (list: Element) =>
  [...list.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]);

describe('AdminSidebar', () => {
  it('is a nav named "<organization> admin"', async () => {
    const { host } = await render(BASE);
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Coastal Bend Rec Club admin',
    );
  });

  it('starts with the organization link to /app: the mark, the name, and "Switch organization"', async () => {
    const { host } = await render(BASE);
    const head = host.querySelector('nav a')!;
    expect(head.getAttribute('href')).toBe('/app');
    expect(text(head.querySelector('[aria-hidden="true"]'))).toBe('CB');
    expect(text(head)).toBe('CBCoastal Bend Rec ClubSwitch organization');
    expect(text(head.querySelector('.truncate'))).toBe('Coastal Bend Rec Club');
  });

  it('lists Overview, a Programs group of Leagues, Tournaments, and Camps, then Locations, Staff, and Details, then View public page', async () => {
    const { host } = await render(BASE);
    const lists = [...host.querySelectorAll('nav ul')];
    expect(lists).toHaveLength(4);
    for (const list of lists) expect(list.getAttribute('role')).toBe('list');
    expect(links(lists[0])).toEqual([['Overview', BASE]]);
    expect(links(lists[1])).toEqual([
      ['Leagues', `${BASE}/leagues`],
      ['Tournaments', `${BASE}/tournaments`],
      ['Camps', `${BASE}/camps`],
    ]);
    expect(links(lists[2])).toEqual([
      ['Locations', `${BASE}/locations`],
      ['Staff', `${BASE}/staff`],
      ['Details', `${BASE}/details`],
    ]);
    expect(links(lists[3])).toEqual([['View public page', `/organizations/${COASTAL.slug}`]]);
    expect(lists[3].classList.contains('border-t')).toBe(true);
  });

  it('names the Programs group with a visible label and the list it holds', async () => {
    const { host } = await render(BASE);
    const group = host.querySelector('ul[aria-label="Programs"]')!;
    expect(text(group.previousElementSibling)).toBe('Programs');
    expect(classes(group.previousElementSibling!)).toEqual(tokens(SIDEBAR_GROUP_LABEL));
  });

  it('has no "Your organizations" link, because the head goes there', async () => {
    const { host } = await render(BASE);
    expect(host.textContent).not.toContain('Your organizations');
  });

  describe('counts', () => {
    it('asks the four counters with the organization id, and only once Convex has accepted the token', async () => {
      const { convex, authenticate } = await render(BASE);
      expect(convex.subscriptions).toEqual([]);
      authenticate();
      expect(convex.activeSubscriptions.map((s) => [s.name, s.args]).sort()).toEqual(
        [PUBLISHED_COUNT, DRAFT_COUNT, LIST_LOCATIONS, STAFF_COUNT]
          .map((name) => [name, { organizationId: COASTAL.organizationId }])
          .sort(),
      );
    });

    it('shows no count while they load', async () => {
      const { host, authenticate } = await render(BASE);
      authenticate();
      expect(host.querySelectorAll('.tabular-nums')).toHaveLength(0);
    });

    it('counts leagues as the published ones plus the drafts, then locations and staff', async () => {
      const { host, authenticate, answer } = await render(BASE);
      authenticate();
      await answer(PUBLISHED_COUNT, 3);
      await answer(DRAFT_COUNT, 2);
      await answer(LIST_LOCATIONS, COASTAL_LOCATIONS);
      await answer(STAFF_COUNT, 4);
      const counts = [...host.querySelectorAll('nav ul')]
        .slice(0, -1)
        .flatMap((list) => [...list.querySelectorAll('li')])
        .map((li) => [
          text(li.querySelector('a span.flex-1')),
          text(li.querySelector('.tabular-nums')) ?? null,
        ]);
      expect(counts).toEqual([
        ['Overview', null],
        ['Leagues', '5'],
        ['Tournaments', null],
        ['Camps', null],
        ['Locations', '3'],
        ['Staff', '4'],
        ['Details', null],
      ]);
    });

    it('counts leagues from the counters, past the 200 rows the league list stops at', async () => {
      const { host, authenticate, answer } = await render(BASE);
      authenticate();
      await answer(PUBLISHED_COUNT, 450);
      await answer(DRAFT_COUNT, 320);
      expect(text(host.querySelector(`a[href="${BASE}/leagues"] .tabular-nums`))).toBe('770');
    });

    it('shows no count for one that failed, and the others stay', async () => {
      const { host, convex, fixture, authenticate, answer } = await render(BASE);
      authenticate();
      await answer(LIST_LOCATIONS, COASTAL_LOCATIONS);
      convex.activeSubscriptions.find((s) => s.name === STAFF_COUNT)?.fail(new Error('boom'));
      await fixture.whenStable();
      expect(text(host.querySelector(`a[href="${BASE}/locations"] .tabular-nums`))).toBe('3');
      expect(host.querySelector(`a[href="${BASE}/staff"] .tabular-nums`)).toBeNull();
    });
  });

  it('marks Overview current on the overview path, with the mockup classes', async () => {
    const { host } = await render(BASE);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Overview');
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
    expect(classes(current[0].querySelector('ng-icon')!)).toEqual(
      expect.arrayContaining(tokens(SIDEBAR_ICON_CURRENT)),
    );
    const locations = host.querySelector(`a[href="${BASE}/locations"]`)!;
    expect(classes(locations)).toEqual(tokens(SIDEBAR_ROW));
    expect(classes(locations.querySelector('ng-icon')!)).toEqual(
      expect.arrayContaining(tokens(SIDEBAR_ICON)),
    );
    expect(locations.hasAttribute('aria-current')).toBe(false);
  });

  it('keeps every row 44px tall on touch screens', async () => {
    const { host } = await render(BASE);
    for (const link of host.querySelectorAll('a')) {
      expect(link.className).toMatch(/(^|\s)(pointer-coarse:)?min-h-11(\s|$)/);
    }
  });

  it('marks Locations current on the locations path, and ignores a query string and a fragment', async () => {
    const { host } = await render(`${BASE}/locations?x=1#add-location`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Locations');
  });

  it('marks Leagues current on the leagues path, and ignores a query string and a fragment', async () => {
    const { host } = await render(`${BASE}/leagues?x=1#create-league`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Leagues');
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
  });

  it('marks Leagues as the section of a league management page: aria-current="true", the same classes', async () => {
    const { host } = await render(`${BASE}/leagues/coed-7v7-rec?x=1#create-season`);
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    const current = host.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Leagues');
    expect(current[0].getAttribute('href')).toBe(`${BASE}/leagues`);
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
  });

  it('keeps the Leagues link at its URL with aria-current="page" now that it sits in the group', async () => {
    const { host } = await render(`${BASE}/leagues`);
    const leagues = host.querySelector('ul[aria-label="Programs"] a[href$="/leagues"]')!;
    expect(leagues.getAttribute('href')).toBe(`${BASE}/leagues`);
    expect(leagues.getAttribute('aria-current')).toBe('page');
    expect(host.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('marks Tournaments current on the tournaments path, and ignores a query string and a fragment', async () => {
    const { host } = await render(`${BASE}/tournaments?x=1#create-tournament`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Tournaments');
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
    expect(text(host.querySelector(`a[href="${BASE}/leagues"]`))).toBe('Leagues');
    expect(host.querySelector(`a[href="${BASE}/leagues"]`)!.hasAttribute('aria-current')).toBe(
      false,
    );
  });

  it('marks Tournaments as the section of a tournament management page: aria-current="true", the same classes', async () => {
    const { host } = await render(`${BASE}/tournaments/winter-doubles-classic?x=1#details`);
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    const current = host.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Tournaments');
    expect(current[0].getAttribute('href')).toBe(`${BASE}/tournaments`);
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
  });

  it('marks Camps current on the camps path, and ignores a query string and a fragment', async () => {
    const { host } = await render(`${BASE}/camps?x=1#create-camp`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Camps');
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
  });

  it('marks Camps as the section of a camp page: aria-current="true"', async () => {
    const { host } = await render(`${BASE}/camps/junior-beach-volleyball-camp`);
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    const current = host.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe(`${BASE}/camps`);
  });

  it('marks Staff current on the staff path, and ignores a query string and a fragment', async () => {
    const { host } = await render(`${BASE}/staff?x=1#invite`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Staff');
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
  });

  it('marks Details current with aria-current="page" on the details path', async () => {
    const { host } = await render(`${BASE}/details`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Details');
    expect(current[0].getAttribute('href')).toBe(`${BASE}/details`);
    expect(classes(current[0])).toEqual(tokens(SIDEBAR_ROW_CURRENT));
  });

  it('follows navigation without being re-created', async () => {
    const { fixture, router, host } = await render(BASE);
    await router.navigateByUrl(`${BASE}/locations`);
    await fixture.whenStable();
    expect(text(host.querySelector('[aria-current="page"]'))).toBe('Locations');
  });

  it('marks nothing current on a path of its own organization it has no entry for', async () => {
    const { host } = await render(`${BASE}/billing`);
    expect(host.querySelector('[aria-current]')).toBeNull();
  });

  it('carries no id, because the sheet renders it a second time', async () => {
    const { host } = await render(BASE);
    expect(host.querySelectorAll('[id]')).toHaveLength(0);
  });
});
