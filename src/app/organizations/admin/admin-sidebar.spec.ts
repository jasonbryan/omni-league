import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AdminSidebar } from './admin-sidebar';
import { COASTAL, Elsewhere, text } from './testing/admin-harness';

// The admin sidebar (#65), design/mockups/65-organization-admin-locations.html "Admin sidebar".

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
  'flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground';
const OTHER =
  'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-muted';
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

  it('lists Overview and Locations, then Public page and Your organizations, in two lists', async () => {
    const { host } = await render(BASE);
    const lists = [...host.querySelectorAll('nav ul')];
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list.getAttribute('role')).toBe('list');
    const links = (list: Element) =>
      [...list.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]);
    expect(links(lists[0])).toEqual([
      ['Overview', BASE],
      ['Locations', `${BASE}/locations`],
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

  it('follows navigation without being re-created', async () => {
    const { fixture, router, host } = await render(BASE);
    await router.navigateByUrl(`${BASE}/locations`);
    await fixture.whenStable();
    expect(text(host.querySelector('[aria-current="page"]'))).toBe('Locations');
  });

  it('marks nothing current on a path of its own organization it has no entry for', async () => {
    const { host } = await render(`${BASE}/leagues`);
    expect(host.querySelector('[aria-current]')).toBeNull();
  });

  it('carries no id, because the sheet renders it a second time', async () => {
    const { host } = await render(BASE);
    expect(host.querySelectorAll('[id]')).toHaveLength(0);
  });
});
