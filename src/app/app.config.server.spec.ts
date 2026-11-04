import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { config } from './app.config.server';
import { CONVEX_SERVER_QUERIES } from './core/data/convex/inject-query';
import { ConvexServerQueryLoader } from './core/data/convex/server-query-loader';

describe('server config', () => {
  it('provides the Convex server query loader that injectQuery uses during a render', () => {
    TestBed.configureTestingModule({
      providers: [...config.providers, { provide: PLATFORM_ID, useValue: 'server' }],
    });

    expect(TestBed.inject(CONVEX_SERVER_QUERIES)).toBe(TestBed.inject(ConvexServerQueryLoader));
  });
});
