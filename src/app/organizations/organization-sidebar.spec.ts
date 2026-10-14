import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LOAD_PAGE } from '../shell/follow-link';
import { OrganizationSidebar } from './organization-sidebar';
import { GULF_COAST } from './testing/pages';

const PATH = `/organizations/${GULF_COAST.slug}`;

@Component({
  selector: 'app-sidebar-host',
  imports: [OrganizationSidebar],
  template: `
    <app-organization-sidebar [page]="page" />
    <section>
      <h3 id="league-2">League 2</h3>
      <h3 id="location-3">Location 3</h3>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SidebarHost {
  readonly page = GULF_COAST;
}

@Component({ selector: 'app-blank', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

async function render(url: string) {
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
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const link = (href: string): HTMLAnchorElement => {
    const anchor = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    if (!anchor) throw new Error(`no link ${href}`);
    return anchor;
  };
  const scrolled: string[] = [];
  // jsdom has no scrollIntoView.
  for (const heading of host.querySelectorAll<HTMLElement>('h3')) {
    heading.scrollIntoView = () => scrolled.push(heading.id);
  }
  const navigate = vi.spyOn(router, 'navigateByUrl');
  return { router, link, loadPage, scrolled, navigate };
}

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

describe('OrganizationSidebar same-path links', () => {
  it('keeps the hrefs query-free', async () => {
    const { link } = await render(`${PATH}?utm_source=x`);
    expect(link(`${PATH}#league-2`)).toBeTruthy();
    expect(link(`${PATH}#location-3`)).toBeTruthy();
  });

  for (const [kind, hash, target] of [
    ['league', '#league-2', 'league-2'],
    ['location', '#location-3', 'location-3'],
  ]) {
    it(`a plain click on a ${kind} link navigates through the router to the path, the current search, and the hash, then scrolls to the row`, async () => {
      const { router, link, scrolled, navigate, loadPage } = await render(
        `${PATH}?utm_source=x&ott=abc#top`,
      );
      const event = click(link(`${PATH}${hash}`));

      expect(event.prevented).toBe(true);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(`${PATH}?utm_source=x&ott=abc${hash}`);
      await vi.waitFor(() => {
        expect(scrolled).toEqual([target]);
      });
      expect(router.url).toBe(`${PATH}?utm_source=x&ott=abc${hash}`);
      expect(loadPage).not.toHaveBeenCalled();
    });
  }

  it('with no query string, navigates to the path and the hash', async () => {
    const { router, link, scrolled, navigate } = await render(PATH);
    click(link(`${PATH}#league-2`));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`${PATH}#league-2`);
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['league-2']);
    });
    expect(router.url).toBe(`${PATH}#league-2`);
  });

  it('replaces the current hash on a second click, and scrolls again on a repeated one', async () => {
    const { router, link, scrolled } = await render(`${PATH}?utm_source=x`);
    click(link(`${PATH}#league-2`));
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['league-2']);
    });
    click(link(`${PATH}#location-3`));
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['league-2', 'location-3']);
    });
    expect(router.url).toBe(`${PATH}?utm_source=x#location-3`);
    click(link(`${PATH}#location-3`));
    await vi.waitFor(() => {
      expect(scrolled).toEqual(['league-2', 'location-3', 'location-3']);
    });
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
      const event = click(link(`${PATH}#league-2`), init);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(event.prevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(loadPage).not.toHaveBeenCalled();
      expect(scrolled).toEqual([]);
    });
  }

  it('a click already prevented by another handler is left alone', async () => {
    const { link, navigate } = await render(`${PATH}?utm_source=x`);
    const anchor = link(`${PATH}#league-2`);
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

  it('a link that is not on the current path is left to the browser', async () => {
    const { link, navigate } = await render('/organizations/another-club?utm_source=x');
    const event = click(link(`${PATH}#league-2`));
    expect(event.prevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
