import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmBreadcrumbImports } from './index';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

@Component({
  imports: [HlmBreadcrumbImports],
  template: `
    <nav hlmBreadcrumb aria-label="Breadcrumb">
      <ol hlmBreadcrumbList>
        <li hlmBreadcrumbItem><a hlmBreadcrumbLink link="/organizations/acme">Acme</a></li>
        <li hlmBreadcrumbSeparator></li>
        <li hlmBreadcrumbItem>
          <a hlmBreadcrumbPage link="/organizations/acme/leagues/coed">Coed</a>
        </li>
      </ol>
    </nav>
  `,
})
class Host {}

describe('helm breadcrumb', () => {
  let root: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }])],
    });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    root = fixture.nativeElement;
  });

  it('marks the nav, list, items, links, and separator with their slots', () => {
    const slots = [...root.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'));
    expect(slots).toEqual([
      'breadcrumb',
      'breadcrumb-list',
      'breadcrumb-item',
      'breadcrumb-link',
      'breadcrumb-separator',
      'breadcrumb-item',
      'breadcrumb-page',
    ]);
  });

  it('names the nav with the page’s own label and adds no role to the nav element', () => {
    const nav = root.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(nav.hasAttribute('role')).toBe(false);
  });

  it('keeps list semantics on the list, because Safari drops them from an unstyled list', () => {
    expect(root.querySelector('ol')!.getAttribute('role')).toBe('list');
  });

  it('hides the separator from assistive technology and draws the chevron', () => {
    const separator = root.querySelector('[data-slot="breadcrumb-separator"]')!;
    expect(separator.getAttribute('aria-hidden')).toBe('true');
    expect(separator.getAttribute('role')).toBe('presentation');
    expect(separator.querySelector('ng-icon svg')).not.toBeNull();
  });

  it('links through the router, and the current crumb stays a link with aria-current', () => {
    const [link, page] = [...root.querySelectorAll('a')];
    expect(link.getAttribute('href')).toBe('/organizations/acme');
    expect(link.hasAttribute('aria-current')).toBe(false);
    expect(page.getAttribute('href')).toBe('/organizations/acme/leagues/coed');
    expect(page.getAttribute('aria-current')).toBe('page');
    expect(page.hasAttribute('role')).toBe(false);
    expect(page.hasAttribute('aria-disabled')).toBe(false);
  });

  it('fades the link colour on hover, and shows the current crumb in the foreground colour', () => {
    const [link, page] = [...root.querySelectorAll('a')];
    expect(link.className).toContain('hover:text-foreground');
    expect(link.className).toContain('transition-colors');
    expect(page.className).toContain('font-medium');
    expect(page.className).toContain('text-foreground');
  });
});
