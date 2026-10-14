import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { Router, UrlSerializer } from '@angular/router';
import { SwRegistrationOptions, SwUpdate } from '@angular/service-worker';
import { App } from './app';
import { appConfig } from './app.config';
import { AUTH_CLIENT } from './core/auth/auth-client';
import { AuthService } from './core/auth/auth.service';
import { CONVEX_AUTH, CONVEX_CLIENT, CONVEX_CLIENT_FACTORY } from './core/data/convex';
import { AppUpdates } from './core/service-worker/app-updates';
import { QueryTolerantUrlSerializer } from './core/url-serializer';

// TestBed has no server response, so provideClientHydration() warns NG0505. That warning is a test
// artifact (the real browser receives server-rendered HTML); every other console call fails the test.
const isTestOnlyHydrationWarning = (args: unknown[]) =>
  typeof args[0] === 'string' && args[0].startsWith('NG0505:');

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
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Omni League',
    );
    for (const spy of consoleSpies) {
      expect(spy.mock.calls.filter((args) => !isTestOnlyHydrationWarning(args))).toEqual([]);
      spy.mockRestore();
    }
  });

  it('provides the spartan helm defaults (overlays do not use the popover API)', () => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });

    expect(TestBed.inject(OVERLAY_DEFAULT_CONFIG)).toEqual({ usePopover: false });
  });

  it('registers AuthService as the Convex auth source, with no Better Auth client', () => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });

    expect(TestBed.inject(CONVEX_AUTH)).toBe(TestBed.inject(AuthService));
    expect(TestBed.inject(AUTH_CLIENT)).toBeNull();
    expect(TestBed.inject(AuthService).signedIn()).toBe(false);
  });

  it('provides the service worker, off in development builds, and adds no update prompt', async () => {
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });

    expect(TestBed.inject(SwRegistrationOptions)).toEqual({
      enabled: false,
      registrationStrategy: 'registerWhenStable:30000',
    });
    expect(TestBed.inject(SwUpdate).isEnabled).toBe(false);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(TestBed.inject(AppUpdates).start()).toBe(false);
    expect(document.body.querySelector('app-update-prompt')).toBeNull();
  });

  it('reads a URL with an undecodable query string as its path, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });

    expect(TestBed.inject(UrlSerializer)).toBeInstanceOf(QueryTolerantUrlSerializer);
    expect(TestBed.inject(Router).parseUrl('/organizations/acme?ref=%').toString()).toBe(
      '/organizations/acme',
    );
    expect(warn.mock.calls.filter((args) => !isTestOnlyHydrationWarning(args))).toEqual([]);
    warn.mockRestore();
  });
});
