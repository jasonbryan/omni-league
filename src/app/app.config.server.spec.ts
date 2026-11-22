import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONVEX_SERVER_QUERIES } from './core/data/convex/inject-query';
import { ConvexServerQueryLoader } from './core/data/convex/server-query-loader';

const serverModeOnLoad = globalThis.ngServerMode;

describe('server config', () => {
  // provideServerRendering sets ngServerMode and never clears it, and spec files share one global.
  afterEach(() => {
    globalThis.ngServerMode = serverModeOnLoad;
  });

  it('provides the Convex server query loader that injectQuery uses during a render', async () => {
    const { config } = await import('./app.config.server');
    TestBed.configureTestingModule({
      providers: [...config.providers, { provide: PLATFORM_ID, useValue: 'server' }],
    });

    expect(TestBed.inject(CONVEX_SERVER_QUERIES)).toBe(TestBed.inject(ConvexServerQueryLoader));
  });

  it('leaves server mode as it found it for the spec files after it', () => {
    expect(globalThis.ngServerMode).toBeUndefined();
  });
});
