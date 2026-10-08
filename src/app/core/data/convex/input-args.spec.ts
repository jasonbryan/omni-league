import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  TransferState,
  input,
  makeStateKey,
  type Type,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { convexToJson } from 'convex/values';
import {
  CONVEX_CLIENT_FACTORY,
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_URL,
  injectQuery,
  provideConvex,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';
import { FakeConvexHttpClient } from './testing/fake-convex-http-client';

const listTeams = makeFunctionReference<'query', { leagueId: string }, unknown>('teams:list');
const KEY = 'cvx:teams:list:{"leagueId":"a"}';
const DEPLOYMENT_URL = 'https://happy-otter-123.convex.cloud';

/** Args from a required input, the pattern `angular.md` prescribes (inputs are bound after construction). */
@Component({
  selector: 'app-required-input-probe',
  template: `{{ teams.isLoading() ? 'loading' : teams.value() }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RequiredInputProbe {
  readonly leagueId = input.required<string>();
  readonly teams = injectQuery(listTeams, () => ({ leagueId: this.leagueId() }));
}

/** Args from an input with a default: the default is never the args the render used. */
@Component({
  selector: 'app-default-input-probe',
  template: `{{ teams.isLoading() ? 'loading' : teams.value() }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class DefaultInputProbe {
  readonly leagueId = input('');
  readonly teams = injectQuery(listTeams, () => ({ leagueId: this.leagueId() }));
}

/** Rendered text of a probe fixture. */
const text = (fixture: ComponentFixture<unknown>) =>
  (fixture.nativeElement as HTMLElement).textContent;

const probes: [string, Type<unknown>][] = [
  ['input.required()', RequiredInputProbe],
  ["input('')", DefaultInputProbe],
];

describe('injectQuery with args from component inputs (browser, during hydration)', () => {
  let client: FakeConvexClient;

  beforeEach(() => {
    client = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CONVEX_URL, useValue: DEPLOYMENT_URL },
        { provide: CONVEX_CLIENT_FACTORY, useValue: () => client },
      ],
    });
  });

  /**
   * Pre-populates TransferState as the browser app reads it from ng-state. Called synchronously in
   * the test: injecting in beforeEach would let the app become stable (closing the window) first.
   */
  const transfer = () =>
    TestBed.inject(TransferState).set(makeStateKey<unknown>(KEY), { v: convexToJson('Sharks') });

  it.each(probes)(
    '%s: constructs, seeds for the bound args, and renders the server value on the first render',
    (_, probe) => {
      transfer();
      const fixture = TestBed.createComponent(probe);
      fixture.componentRef.setInput('leagueId', 'a');
      fixture.detectChanges();

      // First browser render matches the server HTML: no loading flash.
      expect(text(fixture)).toBe('Sharks');

      // The live subscription opens for the bound args and its first result replaces the seed.
      expect(client.activeSubscriptions).toHaveLength(1);
      expect(client.subscriptions[0]).toMatchObject({
        name: 'teams:list',
        args: { leagueId: 'a' },
      });
      client.subscriptions[0].emit('Live Sharks');
      fixture.detectChanges();
      expect(text(fixture)).toBe('Live Sharks');
    },
  );

  it.each(probes)(
    '%s: a first render after the application is stable is not seeded',
    async (_, probe) => {
      transfer();
      await TestBed.inject(ApplicationRef).whenStable();
      const fixture = TestBed.createComponent(probe);
      fixture.componentRef.setInput('leagueId', 'a');
      fixture.detectChanges();
      expect(text(fixture)).toBe('loading');
    },
  );
});

describe('injectQuery with args from component inputs (server render)', () => {
  let http: FakeConvexHttpClient;

  beforeEach(() => {
    http = new FakeConvexHttpClient();
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: CONVEX_URL, useValue: DEPLOYMENT_URL },
        { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: () => http },
      ],
    });
  });

  it.each(probes)(
    '%s: constructs without NG0950, fetches the bound args, and renders the value',
    async (_, probe) => {
      const fixture = TestBed.createComponent(probe);
      fixture.componentRef.setInput('leagueId', 'a');
      fixture.detectChanges();

      expect(http.queries).toHaveLength(1);
      expect(http.queries[0]).toMatchObject({ name: 'teams:list', args: { leagueId: 'a' } });

      http.queries[0].resolve('Sharks');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(text(fixture)).toBe('Sharks');
      expect(TestBed.inject(TransferState).get(makeStateKey<unknown>(KEY), null)).toEqual({
        v: 'Sharks',
      });
    },
  );
});
