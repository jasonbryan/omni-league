import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AdminSidebar } from './admin-sidebar';
import { COASTAL, Elsewhere, text } from './testing/admin-harness';

@Component({
  imports: [AdminSidebar],
  template: '<app-admin-sidebar [organization]="organization" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly organization = COASTAL;
}

async function render(url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: '**', component: Elsewhere }])],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  return { fixture, router, host: fixture.nativeElement as HTMLElement };
}

const BASE = `/app/organizations/${COASTAL.slug}`;
const CURRENT =
  'flex min-h-8 pointer-coarse:min-h-11 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground';
const OTHER =
  'flex min-h-8 pointer-coarse:min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted';
const classes = (element: Element) => [...element.classList].sort();
const tokens = (value: string) => value.split(' ').sort();

describe('AdminSidebar', () => {
  it('is a nav named "<organization> admin" with the initials, the name, and "Admin area"', async () => {
    const { host } = await render(BASE);
    const nav = host.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Coastal Bend Rec Club admin');
    expect(text(nav.querySelector('[aria-hidden="true"]'))).toBe('CB');
    expect(text(nav.querySelector('p.font-semibold'))).toBe('Coastal Bend Rec Club');
    expect(text(nav.querySelector('p.text-xs'))).toBe('Admin area');
  });

  it('lists Overview, Locations, Leagues, and Staff, then Public page and Your organizations, in two lists', async () => {
    const { host } = await render(BASE);
    const lists = [...host.querySelectorAll('nav ul')];
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list.getAttribute('role')).toBe('list');
    const links = (list: Element) =>
      [...list.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]);
    expect(links(lists[0])).toEqual([
      ['Overview', BASE],
      ['Locations', `${BASE}/locations`],
      ['Leagues', `${BASE}/leagues`],
      ['Staff', `${BASE}/staff`],
    ]);
    expect(links(lists[1])).toEqual([
      ['Public page', `/organizations/${COASTAL.slug}`],
      ['Your organizations', '/app'],
    ]);
    expect(lists[1].classList.contains('border-t')).toBe(true);
  });

  it('marks Overview current on the overview path, with the mockup classes', async () => {
    const { host } = await render(BASE);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Overview');
    expect(classes(current[0])).toEqual(tokens(CURRENT));
    const locations = host.querySelector(`a[href="${BASE}/locations"]`)!;
    expect(classes(locations)).toEqual(tokens(OTHER));
    expect(locations.hasAttribute('aria-current')).toBe(false);
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
    expect(classes(current[0])).toEqual(tokens(CURRENT));
  });

  it('marks Leagues as the section of a league management page: aria-current="true", the same classes', async () => {
    const { host } = await render(`${BASE}/leagues/coed-7v7-rec?x=1#create-season`);
    expect(host.querySelector('[aria-current="page"]')).toBeNull();
    const current = host.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Leagues');
    expect(current[0].getAttribute('href')).toBe(`${BASE}/leagues`);
    expect(classes(current[0])).toEqual(tokens(CURRENT));
  });

  it('marks Staff current on the staff path, and ignores a query string and a fragment', async () => {
    const { host } = await render(`${BASE}/staff?x=1#invite`);
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toBe('Staff');
    expect(classes(current[0])).toEqual(tokens(CURRENT));
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
