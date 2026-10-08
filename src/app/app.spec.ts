import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App routing', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it("renders the placeholder inside the root router-outlet for ''", async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    const outlet = root.querySelector('router-outlet');
    expect(outlet).not.toBeNull();
    const routed = outlet?.nextElementSibling;
    expect(routed?.tagName.toLowerCase()).toBe('app-placeholder');
    expect(routed?.querySelector('h1')?.textContent).toBe('Omni League');
  });
});
