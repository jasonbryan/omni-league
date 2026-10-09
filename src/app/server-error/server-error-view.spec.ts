import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { NotFoundView } from '../not-found/not-found-view';
import { ServerErrorView } from './server-error-view';

function create(responseInit?: ResponseInit) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...(responseInit ? [{ provide: RESPONSE_INIT, useValue: responseInit }] : []),
    ],
  });
  const fixture = TestBed.createComponent(ServerErrorView);
  fixture.componentRef.setInput('retryHref', '/organizations/gulf-coast-sport-social');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ServerErrorView', () => {
  it('renders the approved server-error card (design/mockups/60-organization-page.html)', () => {
    const host = create();
    expect(host.className).toBe('block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(text(host.querySelector('h1'))).toBe('This page is temporarily unavailable');
    expect(text(host.querySelector('p'))).toBe(
      'Omni League could not load it just now. It will appear here as soon as it loads, or you can try again.',
    );
    expect(host.querySelector('ng-icon[name="lucideCloudOff"]')).not.toBeNull();
  });

  it('links Try again to the given path as a plain link, so it works before hydration', () => {
    const link = create().querySelector('a');
    expect(text(link)).toBe('Try again');
    expect(link?.getAttribute('href')).toBe('/organizations/gulf-coast-sport-social');
    expect(link?.querySelector('ng-icon[name="lucideRotateCw"]')).not.toBeNull();
  });

  it("uses the not-found view's large button classes for its link", () => {
    const link = create().querySelector('a');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const notFound = TestBed.createComponent(NotFoundView);
    notFound.detectChanges();
    const home = (notFound.nativeElement as HTMLElement).querySelector('a');
    expect(link?.className).toBe(home?.className);
    expect(link?.getAttribute('data-slot')).toBe('button');
  });

  it('sets the title, status 503, and Cache-Control: no-store on the server', () => {
    const responseInit: ResponseInit = { headers: new Headers({ 'Cache-Control': 'public' }) };
    create(responseInit);
    expect(TestBed.inject(Title).getTitle()).toBe('Temporarily unavailable | Omni League');
    expect(responseInit.status).toBe(503);
    expect(new Headers(responseInit.headers).get('Cache-Control')).toBe('no-store');
  });
});
