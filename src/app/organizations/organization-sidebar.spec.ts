import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LOAD_PAGE } from '../shell/follow-link';
import type { PublicOrganizationHeader } from './organization-path';
import { OrganizationSidebar } from './organization-sidebar';
import { GULF_COAST, GULF_COAST_HEADER as HEADER } from './testing/pages';

const PATH = `/organizations/${GULF_COAST.slug}`;

@Component({
  selector: 'app-sidebar-host',
  imports: [OrganizationSidebar],
  template: `
    <app-organization-sidebar [organization]="organization()" [currentSport]="currentSport()" />
    <section>
      <h2 id="locations">Locations</h2>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SidebarHost {
  readonly organization = signal<PublicOrganizationHeader>(HEADER);
  readonly currentSport = signal<string | undefined>(undefined);
}

@Component({ selector: 'app-blank', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

async function render(url: string, options: { currentSport?: string } = {}) {
  const loadPage = vi.fn<(url: string) => void>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: LOAD_PAGE, useValue: loadPage },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(SidebarHost);
  fixture.componentInstance.currentSport.set(options.currentSport);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const link = (href: string): HTMLAnchorElement => {
    const anchor = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    if (!anchor) throw new Error(`no link ${href}`);
    return anchor;
  };
  const scrolled: string[] = [];
  // jsdom has no scrollIntoView.
  for (const heading of host.querySelectorAll<HTMLElement>('h2')) {
    heading.scrollIntoView = () => scrolled.push(heading.id);
  }
  const navigate = vi.spyOn(router, 'navigateByUrl');
  return { fixture, host, router, link, loadPage, scrolled, navigate };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Dispatches a click and reports whether a handler prevented its default action. The default
 * action of an unprevented link click is cancelled afterwards, so jsdom does not try to navigate.
 */
function click(target: HTMLElement, init: MouseEventInit = {}): { prevented: boolean } {
  const result = { prevented: false };
  const record = (event: Event) => {
    result.prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', record, { once: true });
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }),
  );
  document.removeEventListener('click', record);
  return result;
}

describe('OrganizationSidebar', () => {
  it('lists Overview first, then the sports with their league counts, then one Locations item', async () => {
    const { host } = await render(PATH);
    const nav = host.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe(GULF_COAST.name);
    const items = [...host.querySelectorAll('nav ul > li > a')];
    expect(items.map((a) => a.getAttribute('href'))).toEqual([
      PATH,
      `${PATH}/sports/beach-volleyball`,
      `${PATH}/sports/soccer`,
      `${PATH}/sports/softball`,
      `${PATH}#locations`,
    ]);
    expect(items.map(text)).toEqual([
      'Overview',
      'Beach volleyball 2 leagues',
      'Soccer 2 leagues',
      'Softball 1 league',
      'Locations 3 locations',
    ]);
  });

  it('marks Overview as the current page on the organization page, and no sport', async () => {
    const { host } = await render(PATH);
    const current = [...host.querySelectorAll('[aria-current]')];
    expect(current.map(text)).toEqual(['Overview']);
    expect(current[0].getAttribute('aria-current')).toBe('page');
  });

  it('marks the open sport as the current page instead of Overview', async () => {
    const { host } = await render(`${PATH}/sports/soccer`, { currentSport: 'soccer' });
    const current = [...host.querySelectorAll('[aria-current]')];
    expect(current.map(text)).toEqual(['Soccer 2 leagues']);
    expect(current[0].getAttribute('aria-current')).toBe('page');
    expect(current[0].className).toContain('bg-sidebar-accent');
    const overview = [...host.querySelectorAll('a')].find((a) => text(a) === 'Overview');
    expect(overview?.hasAttribute('aria-current')).toBe(false);
    expect(overview?.className).not.toContain('bg-sidebar-accent');
  });

  it('names the Sports group and gives each entry the count in its accessible name', async () => {
    const { host } = await render(PATH);
    const group = host.querySelector('ul[aria-label="Sports"]');
    expect(group).not.toBeNull();
    expect([...(group?.querySelectorAll('a') ?? [])].map(text)).toEqual([
      'Beach volleyball 2 leagues',
      'Soccer 2 leagues',
      'Softball 1 league',
    ]);
    // The count is visible, and its unit is read only by screen readers.
    const count = group?.querySelector('a span.ms-auto');
    expect(count?.firstChild?.textContent).toBe('2');
    expect(count?.querySelector('.sr-only')?.textContent?.trim()).toBe('leagues');
  });

  it('lists only the sports the organization has leagues in', async () => {
    const { fixture, host } = await render(PATH);
    fixture.componentInstance.organization.set({
      ...HEADER,
      sportCount: 2,
      sports: HEADER.sports.filter((sport) => sport.key !== 'softball'),
    });
    await fixture.whenStable();
    expect([...host.querySelectorAll('ul[aria-label="Sports"] a')].map((a) => text(a))).toEqual([
      'Beach volleyball 2 leagues',
      'Soccer 2 leagues',
    ]);
    expect(text(host)).not.toContain('Softball');
  });

  it('shows "None yet" and no list when the organization has no league', async () => {
    const { fixture, host } = await render(PATH);
    fixture.componentInstance.organization.set({
      ...HEADER,
      leagueCount: 0,
      sportCount: 0,
      sports: [],
    });
    await fixture.whenStable();
    expect(host.querySelector('ul[aria-label="Sports"]')).toBeNull();
    const heading = [...host.querySelectorAll('nav p')].find((p) => text(p) === 'Sports');
    expect(text(heading?.nextElementSibling)).toBe('None yet');
    // Locations stays, with its own count.
    expect(text([...host.querySelectorAll('a')].at(-1))).toBe('Locations 3 locations');
  });

  it('uses the singular for one location', async () => {
    const { fixture, host } = await render(PATH);
    fixture.componentInstance.organization.set({ ...HEADER, locationCount: 1 });
    await fixture.whenStable();
    expect(text([...host.querySelectorAll('a')].at(-1))).toBe('Locations 1 location');
  });

  it('lists no league or location of the organization', async () => {
    const { host } = await render(PATH);
    expect(host.querySelector('a[href*="#league-"], a[href*="#location-"]')).toBeNull();
    expect(host.querySelector('ul[aria-label="Leagues"], ul[aria-label="Locations"]')).toBeNull();
  });

  it('builds every href from the slugs, never from the request’s query string', async () => {
    const { host } = await render(`${PATH}?ott=SECRET&utm_source=x`);
    for (const a of host.querySelectorAll('a')) {
      expect(a.getAttribute('href')).not.toContain('SECRET');
      expect(a.getAttribute('href')).not.toContain('?');
    }
  });

  it('a sport entry is a router link: a plain click navigates without a page load', async () => {
    const { link, loadPage, router } = await render(PATH);
    const event = click(link(`${PATH}/sports/soccer`));
    expect(event.prevented).toBe(true);
    await vi.waitFor(() => {
      expect(router.url).toBe(`${PATH}/sports/soccer`);
    });
    expect(loadPage).not.toHaveBeenCalled();
  });
});

describe('OrganizationSidebar Locations item (#95)', () => {
  it('on the organization page a plain click navigates through the router to the path, the current search, and #locations, then scrolls to the panel', async () => {
    const { router, link, scrolled, navigate, loadPage } = await render(
      `${PATH}?utm_source=x&ott=abc#top`,
    );
    const event = click(link(`${PATH}#locations`));

    expect(event.prevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`${PATH}?utm_source=x&ott=abc#locations`);
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['locations']);
    });
    expect(router.url).toBe(`${PATH}?utm_source=x&ott=abc#locations`);
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('with no query string, navigates to the path and #locations, and scrolls again on a repeated click', async () => {
    const { router, link, scrolled, navigate } = await render(PATH);
    click(link(`${PATH}#locations`));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`${PATH}#locations`);
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['locations']);
    });
    click(link(`${PATH}#locations`));
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['locations', 'locations']);
    });
    expect(router.url).toBe(`${PATH}#locations`);
  });

  it('on a sport view a plain click goes to the organization page with no query string of the sport view', async () => {
    const { router, link, navigate, loadPage } = await render(`${PATH}/sports/soccer?page=2`, {
      currentSport: 'soccer',
    });
    const event = click(link(`${PATH}#locations`));
    expect(event.prevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`${PATH}#locations`);
    await vi.waitFor(() => {
      expect(router.url).toBe(`${PATH}#locations`);
    });
    expect(loadPage).not.toHaveBeenCalled();
  });

  const modified: [string, MouseEventInit][] = [
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['the middle button', { button: 1 }],
  ];
  for (const [name, init] of modified) {
    it(`a click with ${name} is left to the browser: no router navigation, not prevented`, async () => {
      const { link, navigate, loadPage, scrolled } = await render(`${PATH}?utm_source=x`);
      const event = click(link(`${PATH}#locations`), init);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(event.prevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(loadPage).not.toHaveBeenCalled();
      expect(scrolled).toEqual([]);
    });
  }

  it('a click already prevented by another handler is left alone', async () => {
    const { link, navigate } = await render(`${PATH}?utm_source=x`);
    const anchor = link(`${PATH}#locations`);
    // Capture on the parent runs before the link's own handlers.
    anchor.parentElement?.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
      },
      { capture: true },
    );
    click(anchor);
    expect(navigate).not.toHaveBeenCalled();
  });
});
