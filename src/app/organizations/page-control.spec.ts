import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buttonVariants } from '../ui/button/hlm-button';
import {
  CURRENT_PAGE_BUTTON,
  GHOST_BUTTON,
  GHOST_ICON_BUTTON,
  PageControl,
  pageWindow,
  rangeText,
} from './page-control';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

const PATH = '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s';

interface Inputs {
  page: number;
  pageCount: number;
  total: number;
}

function render(inputs: Inputs) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: '**', component: Blank }])],
  });
  const fixture = TestBed.createComponent(PageControl);
  fixture.componentRef.setInput('label', 'Seasons pages');
  fixture.componentRef.setInput('noun', 'seasons');
  fixture.componentRef.setInput('path', PATH);
  fixture.componentRef.setInput('fragment', 'seasons');
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  return fixture;
}

const navOf = (fixture: ComponentFixture<PageControl>): HTMLElement | null =>
  (fixture.nativeElement as HTMLElement).querySelector('nav');
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('pageWindow', () => {
  const shown = (page: number, count: number, view: 'wide' | 'narrow') =>
    pageWindow(page, count)
      .filter((item) => (item.kind === 'page' ? true : item.view === view))
      .filter((item) => item.kind === 'gap' || view === 'wide' || !item.narrowHidden)
      .map((item) => (item.kind === 'gap' ? '…' : String(item.n)))
      .join(' ');

  it.each([
    [1, 1, '1'],
    [1, 2, '1 2'],
    [2, 3, '1 2 3'],
    [3, 4, '1 2 3 4'],
  ])('lists every page up to 4, page %i of %i: %s', (page, count, expected) => {
    expect(shown(page, count, 'wide')).toBe(expected);
    expect(shown(page, count, 'narrow')).toBe(expected);
  });

  it('lists all 5 pages from 640px and the first, the current, and the last below', () => {
    expect(shown(3, 5, 'wide')).toBe('1 2 3 4 5');
    expect(shown(1, 5, 'wide')).toBe('1 2 3 4 5');
    expect(shown(3, 5, 'narrow')).toBe('1 … 3 … 5');
    expect(shown(1, 5, 'narrow')).toBe('1 … 5');
  });

  it('page 3 of 6 is 1 2 3 4 … 6 from 640px and 1 … 3 … 6 below', () => {
    expect(shown(3, 6, 'wide')).toBe('1 2 3 4 … 6');
    expect(shown(3, 6, 'narrow')).toBe('1 … 3 … 6');
  });

  it('page 1 of 40 keeps the first, the current, and the last', () => {
    expect(shown(1, 40, 'wide')).toBe('1 2 … 40');
    expect(shown(1, 40, 'narrow')).toBe('1 … 40');
  });

  it('page 40 of 40 keeps the first, the current, and the last', () => {
    expect(shown(40, 40, 'wide')).toBe('1 … 39 40');
    expect(shown(40, 40, 'narrow')).toBe('1 … 40');
  });

  it('a middle page keeps its neighbours from 640px and has no gap beside them', () => {
    expect(shown(20, 40, 'wide')).toBe('1 … 19 20 21 … 40');
    expect(shown(20, 40, 'narrow')).toBe('1 … 20 … 40');
    expect(shown(2, 6, 'wide')).toBe('1 2 3 … 6');
    expect(shown(5, 6, 'wide')).toBe('1 … 4 5 6');
    expect(shown(5, 6, 'narrow')).toBe('1 … 5 6');
  });
});

describe('rangeText', () => {
  it('names the first and last row on the page and the total', () => {
    expect(rangeText(1, 7)).toBe('1–5 of 7');
    expect(rangeText(2, 7)).toBe('6–7 of 7');
    expect(rangeText(3, 26)).toBe('11–15 of 26');
    expect(rangeText(40, 205)).toBe('196–200 of 205');
  });
});

describe('PageControl', () => {
  it.each([0, 3, 5])('renders nothing when the total is %i, 5 or fewer', (total) => {
    const fixture = render({ page: 1, pageCount: total ? 1 : 0, total });
    expect(navOf(fixture)).toBeNull();
  });

  it('renders the control for a total of 6: two pages', () => {
    const fixture = render({ page: 1, pageCount: 2, total: 6 });
    const nav = navOf(fixture)!;
    expect(nav.getAttribute('aria-label')).toBe('Seasons pages');
    expect(text(nav.querySelector('p'))).toBe('1–5 of 6 seasons');
    expect(nav.querySelector('p .sr-only')?.textContent).toBe(' seasons');
  });

  it('page 1 of 2: Previous is aria-disabled and not a link, page 1 is current, and Next and page 2 link to ?page=2#seasons', () => {
    const fixture = render({ page: 1, pageCount: 2, total: 7 });
    const nav = navOf(fixture)!;
    const previous = nav.querySelector<HTMLElement>('li:first-child > *')!;
    expect(previous.tagName).toBe('SPAN');
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(previous.hasAttribute('href')).toBe(false);
    expect(text(previous)).toBe('Previous page');

    const links = [...nav.querySelectorAll('a')].map((a) => [
      text(a),
      a.getAttribute('href'),
      a.getAttribute('aria-current'),
    ]);
    expect(links).toEqual([
      ['Page 1', `${PATH}#seasons`, 'page'],
      ['Page 2', `${PATH}?page=2#seasons`, null],
      ['Next page', `${PATH}?page=2#seasons`, null],
    ]);
  });

  it('the last page: Next is aria-disabled and not a link, and Previous and page 1 link to the bare path with the fragment', () => {
    const fixture = render({ page: 2, pageCount: 2, total: 7 });
    const nav = navOf(fixture)!;
    expect(text(nav.querySelector('p'))).toBe('6–7 of 7 seasons');
    const next = nav.querySelector<HTMLElement>('li:last-child > *')!;
    expect(next.tagName).toBe('SPAN');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(text(next)).toBe('Next page');
    expect(
      [...nav.querySelectorAll('a')].map((a) => [
        text(a),
        a.getAttribute('href'),
        a.getAttribute('aria-current'),
      ]),
    ).toEqual([
      ['Previous page', `${PATH}#seasons`, null],
      ['Page 1', `${PATH}#seasons`, null],
      ['Page 2', `${PATH}?page=2#seasons`, 'page'],
    ]);
  });

  it('a middle page of 6 links Previous to page 2 and Next to page 4, and hides gaps from screen readers', () => {
    const fixture = render({ page: 3, pageCount: 6, total: 26 });
    const nav = navOf(fixture)!;
    const hrefs = [...nav.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]);
    expect(hrefs).toEqual([
      ['Previous page', `${PATH}?page=2#seasons`],
      ['Page 1', `${PATH}#seasons`],
      ['Page 2', `${PATH}?page=2#seasons`],
      ['Page 3', `${PATH}?page=3#seasons`],
      ['Page 4', `${PATH}?page=4#seasons`],
      ['Page 6', `${PATH}?page=6#seasons`],
      ['Next page', `${PATH}?page=4#seasons`],
    ]);
    const gaps = [...nav.querySelectorAll('li[aria-hidden="true"]')];
    expect(gaps).toHaveLength(3);
    expect(gaps.map((gap) => gap.className)).toEqual(['sm:hidden', 'sm:hidden', 'max-sm:hidden']);
    const hiddenNarrow = [...nav.querySelectorAll('li.max-sm\\:hidden:not([aria-hidden])')];
    expect(hiddenNarrow.map(text)).toEqual(['Page 2', 'Page 4']);
  });

  it('Previous and Next show only their chevrons below 640px and keep their names', () => {
    const fixture = render({ page: 3, pageCount: 6, total: 26 });
    const nav = navOf(fixture)!;
    const previous = nav.querySelector<HTMLElement>('li:first-child a')!;
    expect(previous.querySelector('.max-sm\\:sr-only')?.textContent).toBe('Previous');
    expect(previous.className).toContain('max-sm:w-8');
  });

  it('emits the page on a plain activation of a link to another page, and not for the current page', () => {
    const fixture = render({ page: 2, pageCount: 3, total: 11 });
    const activated: number[] = [];
    fixture.componentInstance.pageActivated.subscribe((n) => activated.push(n));
    const nav = navOf(fixture)!;
    for (const a of nav.querySelectorAll('a')) {
      a.addEventListener('click', (event) => event.preventDefault());
      a.click();
    }
    expect(activated).toEqual([1, 1, 3, 3]);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['the middle button', { button: 1 }],
    ['the secondary button', { button: 2 }],
  ])(
    'emits nothing for a click with %s: the page is opened elsewhere and this one stays',
    (_, init) => {
      const fixture = render({ page: 1, pageCount: 3, total: 11 });
      const activated: number[] = [];
      fixture.componentInstance.pageActivated.subscribe((n) => activated.push(n));
      for (const a of navOf(fixture)!.querySelectorAll('a')) {
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
      }
      expect(activated).toEqual([]);
    },
  );

  it('builds each link from queryFor, so a page with two lists keeps the other list’s page', () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }])],
    });
    const fixture = TestBed.createComponent(PageControl);
    const set = (name: string, value: unknown) => fixture.componentRef.setInput(name, value);
    set('label', 'Leagues pages');
    set('noun', 'leagues');
    set('path', '/organizations/acme');
    set('fragment', 'leagues');
    set('page', 3);
    set('pageCount', 6);
    set('total', 26);
    set('queryFor', (page: number) => ({ ...(page > 1 ? { leagues: page } : {}), locations: 2 }));
    fixture.detectChanges();
    expect(
      [...navOf(fixture)!.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]),
    ).toEqual([
      ['Previous page', '/organizations/acme?leagues=2&locations=2#leagues'],
      ['Page 1', '/organizations/acme?locations=2#leagues'],
      ['Page 2', '/organizations/acme?leagues=2&locations=2#leagues'],
      ['Page 3', '/organizations/acme?leagues=3&locations=2#leagues'],
      ['Page 4', '/organizations/acme?leagues=4&locations=2#leagues'],
      ['Page 6', '/organizations/acme?leagues=6&locations=2#leagues'],
      ['Next page', '/organizations/acme?leagues=4&locations=2#leagues'],
    ]);
  });

  it('uses the helm button classes of the mockup', () => {
    expect(GHOST_BUTTON).toBe(
      `${buttonVariants({ variant: 'ghost', size: 'default' })} max-sm:w-8 max-sm:px-0`,
    );
    expect(GHOST_ICON_BUTTON).toBe(
      `${buttonVariants({ variant: 'ghost', size: 'icon' })} tabular-nums`,
    );
    expect(CURRENT_PAGE_BUTTON).toBe(
      `${buttonVariants({ variant: 'secondary', size: 'icon' })} font-semibold tabular-nums`,
    );
    const fixture = render({ page: 1, pageCount: 2, total: 7 });
    const nav = navOf(fixture)!;
    const current = nav.querySelector<HTMLElement>('a[aria-current="page"]')!;
    expect(current.className).toContain('bg-secondary');
    expect(current.className).toContain('tabular-nums');
  });
});
