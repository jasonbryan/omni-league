import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buttonVariants } from '../button/hlm-button';
import {
  CURRENT_PAGE_BUTTON,
  GHOST_BUTTON,
  GHOST_ICON_BUTTON,
  HlmPaginationImports,
} from './index';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

@Component({
  imports: [HlmPaginationImports],
  template: `
    <nav hlmPagination aria-label="Seasons pages">
      <ul hlmPaginationContent>
        <li hlmPaginationItem>
          <a
            hlmPaginationLink
            size="default"
            link="/league"
            [queryParams]="{ page: 1 }"
            fragment="seasons"
            >Previous</a
          >
        </li>
        <li hlmPaginationItem>
          <a hlmPaginationLink [isActive]="true" link="/league">1</a>
        </li>
        <li hlmPaginationItem>
          <a hlmPaginationLink [queryParams]="{ page: 2 }" link="/league" fragment="seasons">2</a>
        </li>
      </ul>
    </nav>
  `,
})
class Host {}

describe('helm pagination', () => {
  let root: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }])],
    });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    root = fixture.nativeElement;
  });

  it('marks the nav, list, items, and links with their slots', () => {
    expect(root.querySelector('nav')!.getAttribute('data-slot')).toBe('pagination');
    expect(root.querySelector('ul')!.getAttribute('data-slot')).toBe('pagination-content');
    expect([...root.querySelectorAll('li')].map((li) => li.getAttribute('data-slot'))).toEqual([
      'pagination-item',
      'pagination-item',
      'pagination-item',
    ]);
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('data-slot'))).toEqual([
      'pagination-link',
      'pagination-link',
      'pagination-link',
    ]);
  });

  it('names the nav with the page’s own label and adds no role to the nav element', () => {
    const nav = root.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Seasons pages');
    expect(nav.hasAttribute('role')).toBe(false);
  });

  it('keeps list semantics on the list, because Safari drops them from an unstyled list', () => {
    expect(root.querySelector('ul')!.getAttribute('role')).toBe('list');
    expect(root.querySelector('ul')!.className.split(' ')).toContain('gap-1');
  });

  it('links through the router with the query parameters and fragment', () => {
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/league?page=1#seasons',
      '/league',
      '/league?page=2#seasons',
    ]);
  });

  it('marks only the active link as the current page', () => {
    expect(
      [...root.querySelectorAll('a')].map((a) => [
        a.getAttribute('aria-current'),
        a.getAttribute('data-active'),
      ]),
    ).toEqual([
      [null, null],
      ['page', 'true'],
      [null, null],
    ]);
  });

  it('styles the links as ghost, current, and ghost icon buttons', () => {
    const classesOf = (a: Element) => new Set(a.className.split(/\s+/));
    const [previous, current, other] = [...root.querySelectorAll('a')].map(classesOf);
    const has = (classes: Set<string>, constant: string) =>
      constant.split(/\s+/).every((name) => classes.has(name));
    expect(has(previous, GHOST_BUTTON)).toBe(true);
    expect(has(current, CURRENT_PAGE_BUTTON)).toBe(true);
    expect(has(other, GHOST_ICON_BUTTON)).toBe(true);
    expect(has(previous, CURRENT_PAGE_BUTTON)).toBe(false);
    expect(has(other, CURRENT_PAGE_BUTTON)).toBe(false);
  });
});

describe('pagination button classes', () => {
  it('match the helm button variants', () => {
    expect(GHOST_BUTTON).toBe(
      `${buttonVariants({ variant: 'ghost', size: 'default' })} max-sm:w-8 max-sm:px-0`,
    );
    expect(GHOST_ICON_BUTTON).toBe(
      `${buttonVariants({ variant: 'ghost', size: 'icon' })} tabular-nums`,
    );
    expect(CURRENT_PAGE_BUTTON).toBe(
      `${buttonVariants({ variant: 'secondary', size: 'icon' })} font-semibold tabular-nums`,
    );
  });
});
