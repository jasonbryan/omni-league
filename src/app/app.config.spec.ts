import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { CONVEX_CLIENT, CONVEX_CLIENT_FACTORY } from './core/data/convex';

// TestBed has no server response, so provideClientHydration() warns NG0505. That warning is a test
// artifact (the real browser receives server-rendered HTML); every other console call fails the test.
const isTestOnlyHydrationWarning = (args: unknown[]) =>
  typeof args[0] === 'string' && args[0].startsWith('NG0505:');

// No Convex URL in the test build, as in CI and the e2e build (#11).
describe('appConfig with no Convex URL', () => {
  it('registers the Convex provider, creates no client, and renders the placeholder silently', async () => {
    const factory = vi.fn();
    const consoleSpies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, { provide: CONVEX_CLIENT_FACTORY, useValue: factory }],
    });

    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();

    expect(TestBed.inject(CONVEX_CLIENT)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe('Omni');
    for (const spy of consoleSpies) {
      expect(spy.mock.calls.filter((args) => !isTestOnlyHydrationWarning(args))).toEqual([]);
      spy.mockRestore();
    }
  });
});
