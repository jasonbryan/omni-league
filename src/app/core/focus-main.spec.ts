import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PlainTestPage } from '../shell/testing/test-pages';
import { focusMainAfterRouteChange } from './focus-main';
import { Shell } from '../shell';

@Component({
  selector: 'app-focus-test-page',
  imports: [Shell],
  template: `
    <app-shell>
      <p>Page</p>
    </app-shell>
  `,
})
class FocusTestPage {
  constructor() {
    focusMainAfterRouteChange();
  }
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

describe('focusMainAfterRouteChange', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'page', component: FocusTestPage },
          { path: '**', component: PlainTestPage },
        ]),
      ],
    });
  });

  it('moves focus to main after a route change into the page', async () => {
    const harness = await RouterTestingHarness.create('/elsewhere');
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl('/page');
    await settle(harness);
    const main = (harness.fixture.nativeElement as HTMLElement).querySelector('main#main');
    expect(main).not.toBeNull();
    expect(document.activeElement).toBe(main);
  });

  it('does nothing on the first navigation, the page load itself', async () => {
    const harness = await RouterTestingHarness.create('/page');
    await settle(harness);
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('main#main'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
