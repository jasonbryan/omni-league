import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PlainTestPage } from '../shell/testing/test-pages';
import { provideFocusMainAfterNavigation } from './focus-main';

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

const mainOf = (harness: RouterTestingHarness) =>
  (harness.fixture.nativeElement as HTMLElement).querySelector('main#main');

function configure(platform: 'browser' | 'server' = 'browser'): void {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      provideRouter([
        { path: 'old', redirectTo: 'new' },
        { path: 'items/:id', component: PlainTestPage },
        { path: '**', component: PlainTestPage },
      ]),
      provideFocusMainAfterNavigation(),
    ],
  });
}

describe('provideFocusMainAfterNavigation', () => {
  it('moves focus to main after a route change to another page', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/elsewhere');
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/page');
    await settle(harness);
    expect(mainOf(harness)).not.toBeNull();
    expect(document.activeElement).toBe(mainOf(harness));
  });

  it('moves focus after a route change that only changes a path parameter', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/items/1');
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/items/2');
    await settle(harness);
    expect(document.activeElement).toBe(mainOf(harness));
  });

  it('moves focus to the page a redirect ends on', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/elsewhere');
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/old');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/new');
    expect(document.activeElement).toBe(mainOf(harness));
  });

  it('does nothing on the first navigation, the page load itself', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/page');
    await settle(harness);
    expect(mainOf(harness)).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing when a redirect ends the page load, which is still the first navigation', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/old');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/new');
    expect(mainOf(harness)).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing when only the query string or the fragment changes', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/page');
    await settle(harness);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/page?page=2');
    await settle(harness);
    expect(document.activeElement).toBe(document.body);
    await router.navigateByUrl('/page?page=2#seasons');
    await settle(harness);
    expect(document.activeElement).toBe(document.body);
    await router.navigateByUrl('/page#form');
    await settle(harness);
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus again after a change of query string was followed by a change of page', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/page');
    await settle(harness);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/page?page=2');
    await router.navigateByUrl('/other?page=2');
    await settle(harness);
    expect(document.activeElement).toBe(mainOf(harness));
  });

  it('leaves focus alone on the server, which has no focus', async () => {
    configure('server');
    const harness = await RouterTestingHarness.create('/elsewhere');
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/page');
    await settle(harness);
    expect(mainOf(harness)).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
