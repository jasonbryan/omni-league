import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ServerErrorView } from '../server-error/server-error-view';
import { NotSavedView } from './not-saved-view';

function create(responseInit?: ResponseInit) {
  TestBed.configureTestingModule({
    providers: responseInit ? [{ provide: RESPONSE_INIT, useValue: responseInit }] : [],
  });
  const fixture = TestBed.createComponent(NotSavedView);
  fixture.componentRef.setInput('retryHref', '/organizations/gulf-coast-sport-social');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('NotSavedView', () => {
  it('renders the approved not-saved card', () => {
    const host = create();
    expect(host.className).toBe('block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(text(host.querySelector('h1'))).toBe("This page isn't saved on this device");
    expect(text(host.querySelector('p'))).toBe(
      "Pages you open while connected stay available here offline. This one will appear as soon as you're connected, or you can try again.",
    );
    expect(host.querySelector('ng-icon[name="lucideWifiOff"]')).not.toBeNull();
    expect(host.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });

  it('links Try again to the given path as a plain, enabled link', () => {
    const link = create().querySelector('a');
    expect(text(link)).toBe('Try again');
    expect(link?.getAttribute('href')).toBe('/organizations/gulf-coast-sport-social');
    expect(link?.hasAttribute('aria-disabled')).toBe(false);
    expect(link?.querySelector('ng-icon[name="lucideRotateCw"]')).not.toBeNull();
  });

  it("uses the server-error view's card and button classes", () => {
    const host = create();
    const card = host.firstElementChild;
    const link = host.querySelector('a');
    TestBed.resetTestingModule();
    const serverError = TestBed.createComponent(ServerErrorView);
    serverError.componentRef.setInput('retryHref', '/x');
    serverError.detectChanges();
    const other = serverError.nativeElement as HTMLElement;
    expect(card?.className).toBe(other.firstElementChild?.className);
    expect(link?.className).toBe(other.querySelector('a')?.className);
  });

  it('sets the title and leaves the response status alone (it renders only in the browser)', () => {
    const responseInit: ResponseInit = {};
    create(responseInit);
    expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
    expect(responseInit.status).toBeUndefined();
  });
});
