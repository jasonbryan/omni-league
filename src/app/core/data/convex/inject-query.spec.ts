import { ChangeDetectionStrategy, Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import type { MockInstance } from 'vitest';
import {
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  ConvexNotConfiguredError,
  injectQuery,
  provideConvex,
  skipToken,
  type SkipToken,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';

const listTeams = makeFunctionReference<'query', { leagueId: string }, string[]>('teams:list');

const leagueId = signal<{ leagueId: string } | SkipToken>({ leagueId: 'a' });

@Component({
  selector: 'app-query-host',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class QueryHost {
  readonly teams = injectQuery(listTeams, () => leagueId());
}

describe('injectQuery (browser, fake client)', () => {
  let client: FakeConvexClient;

  beforeEach(() => {
    client = new FakeConvexClient();
    leagueId.set({ leagueId: 'a' });
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
  });

  function createHost() {
    const fixture = TestBed.createComponent(QueryHost);
    TestBed.tick();
    return { fixture, teams: fixture.componentInstance.teams };
  }

  it('is loading before the first emission and holds the value after it', () => {
    const fixture = TestBed.createComponent(QueryHost);
    const { teams } = fixture.componentInstance;
    expect(teams.isLoading()).toBe(true);
    expect(teams.value()).toBeUndefined();

    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);
    expect(client.subscriptions[0]).toMatchObject({ name: 'teams:list', args: { leagueId: 'a' } });

    client.subscriptions[0].emit(['Sharks']);
    expect(teams.value()).toEqual(['Sharks']);
    expect(teams.isLoading()).toBe(false);
    expect(teams.error()).toBeUndefined();
  });

  it('applies a second emission on the same subscription without opening another', () => {
    const { teams } = createHost();
    client.subscriptions[0].emit(['Sharks']);
    client.subscriptions[0].emit(['Sharks', 'Jets']);
    TestBed.tick();

    expect(teams.value()).toEqual(['Sharks', 'Jets']);
    expect(client.subscriptions).toHaveLength(1);
  });

  it('holds a server error with value undefined, and a later emission clears it', () => {
    const { teams } = createHost();
    client.subscriptions[0].emit(['Sharks']);
    const failure = new ConvexError('league not found');
    client.subscriptions[0].fail(failure);

    expect(teams.error()).toBe(failure);
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);

    client.subscriptions[0].emit(['Jets']);
    expect(teams.error()).toBeUndefined();
    expect(teams.value()).toEqual(['Jets']);
  });

  it('resubscribes on an args change and reports loading with no value until the first emission', () => {
    const { teams } = createHost();
    client.subscriptions[0].emit(['Sharks']);

    leagueId.set({ leagueId: 'b' });
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    expect(client.subscriptions[0].active).toBe(false);
    expect(client.activeSubscriptions).toHaveLength(1);
    expect(client.subscriptions[1].args).toEqual({ leagueId: 'b' });
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    client.subscriptions[1].emit(['Jets']);
    expect(teams.value()).toEqual(['Jets']);
    expect(teams.isLoading()).toBe(false);
  });

  it('ignores an emission from the old subscription after the args change', () => {
    const { teams } = createHost();
    client.subscriptions[0].emit(['Sharks']);

    leagueId.set({ leagueId: 'b' });
    client.subscriptions[0].emit(['Sharks-late']); // old subscription still active until the next tick
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);
  });

  it('does not resubscribe when the args change to a new object with equal content', () => {
    const { teams } = createHost();
    client.subscriptions[0].emit(['Sharks']);

    leagueId.set({ leagueId: 'a' });
    TestBed.tick();

    expect(client.subscriptions).toHaveLength(1);
    expect(client.subscriptions[0].active).toBe(true);
    expect(teams.value()).toEqual(['Sharks']);
  });

  it('opens no subscription and is not loading while the args are skipToken', () => {
    leagueId.set(skipToken);
    const { teams } = createHost();

    expect(client.subscriptions).toHaveLength(0);
    expect(teams.isLoading()).toBe(false);
    expect(teams.value()).toBeUndefined();
    expect(teams.error()).toBeUndefined();
  });

  it('unsubscribes and reports idle when ready args change to skipToken', () => {
    const { teams } = createHost();
    client.subscriptions[0].emit(['Sharks']);

    leagueId.set(skipToken);
    TestBed.tick();

    expect(client.activeSubscriptions).toHaveLength(0);
    expect(client.subscriptions).toHaveLength(1);
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);
    expect(teams.error()).toBeUndefined();
  });

  it('unsubscribes every subscription when the owning component is destroyed', () => {
    const { fixture } = createHost();
    leagueId.set({ leagueId: 'b' });
    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);

    fixture.destroy();

    expect(client.subscriptions).toHaveLength(2);
    expect(client.activeSubscriptions).toHaveLength(0);
  });

  it('accepts static args', () => {
    const teams = TestBed.runInInjectionContext(() => injectQuery(listTeams, { leagueId: 'z' }));
    TestBed.tick();
    expect(client.subscriptions[0].args).toEqual({ leagueId: 'z' });
    expect(teams.isLoading()).toBe(true);
  });
});

describe('injectQuery without a client', () => {
  const factory = vi.fn<(url: string) => FakeConvexClient>();
  let consoleSpies: MockInstance[];

  beforeEach(() => {
    factory.mockReset();
    consoleSpies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  function configure(platform: 'browser' | 'server', url: string | null) {
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: CONVEX_URL, useValue: url },
        { provide: CONVEX_CLIENT_FACTORY, useValue: factory },
      ],
    });
  }

  for (const platform of ['browser', 'server'] as const) {
    it(`reports ConvexNotConfiguredError with no URL on the ${platform} platform`, () => {
      configure(platform, null);
      const teams = TestBed.runInInjectionContext(() => injectQuery(listTeams, { leagueId: 'a' }));
      TestBed.tick();

      expect(factory).not.toHaveBeenCalled();
      expect(teams.value()).toBeUndefined();
      expect(teams.isLoading()).toBe(false);
      expect(teams.error()).toBeInstanceOf(ConvexNotConfiguredError);
      expect(teams.error()?.message).toBe(
        'Convex URL not configured: set CONVEX_URL (see src/app/core/data/convex/README.md)',
      );
    });
  }
  // The server platform with a URL is covered by server-query.spec.ts (#24).
});
