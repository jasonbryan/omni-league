import { ApplicationRef, PLATFORM_ID, TransferState, makeStateKey, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { convexToJson } from 'convex/values';
import {
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  ConvexServerQueryError,
  injectQuery,
  provideConvex,
  skipToken,
} from './index';
import { FakeConvexClient } from './testing/fake-convex-client';

const listTeams = makeFunctionReference<'query', { leagueId: string }, unknown>('teams:list');
const KEY = 'cvx:teams:list:{"leagueId":"a"}';

describe('injectQuery hydration seeding (browser)', () => {
  let client: FakeConvexClient;

  beforeEach(() => {
    client = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideConvex(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
        { provide: CONVEX_CLIENT_FACTORY, useValue: () => client },
      ],
    });
  });

  function transfer(entry: unknown, key = KEY) {
    TestBed.inject(TransferState).set(makeStateKey(key), entry);
  }

  const create = (
    args: { leagueId: string } | (() => { leagueId: string } | typeof skipToken) = {
      leagueId: 'a',
    },
  ) => TestBed.runInInjectionContext(() => injectQuery(listTeams, args));

  it('seeds a transferred { v } synchronously, opens the live subscription, and the first emission replaces it', () => {
    transfer({ v: convexToJson({ count: 5n, names: ['Sharks'] }) });
    const teams = create();

    expect(client.subscriptions).toHaveLength(0);
    expect(teams.value()).toEqual({ count: 5n, names: ['Sharks'] });
    expect(teams.isLoading()).toBe(false);
    expect(teams.error()).toBeUndefined();

    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);
    expect(client.subscriptions[0]).toMatchObject({ name: 'teams:list', args: { leagueId: 'a' } });
    expect(teams.value()).toEqual({ count: 5n, names: ['Sharks'] });

    client.subscriptions[0].emit({ count: 6n, names: ['Sharks', 'Jets'] });
    expect(teams.value()).toEqual({ count: 6n, names: ['Sharks', 'Jets'] });
    expect(teams.isLoading()).toBe(false);
  });

  it('seeds a transferred { u: true } as value undefined and not loading', () => {
    transfer({ u: true });
    const teams = create();

    expect(client.subscriptions).toHaveLength(0);
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);
    expect(teams.error()).toBeUndefined();

    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);
    client.subscriptions[0].emit(['Sharks']);
    expect(teams.value()).toEqual(['Sharks']);
  });

  it('seeds a transferred { e } as ConvexServerQueryError until the first successful emission', () => {
    transfer({ e: { name: 'Error', message: 'Convex query failed during server render' } });
    const teams = create();

    const error = teams.error();
    expect(error).toBeInstanceOf(ConvexServerQueryError);
    expect(error?.name).toBe('ConvexServerQueryError');
    expect(error?.message).toBe('Convex query failed during server render');
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);

    TestBed.tick();
    client.subscriptions[0].emit(['Sharks']);
    expect(teams.error()).toBeUndefined();
    expect(teams.value()).toEqual(['Sharks']);
  });

  it('does not seed once the application has become stable', async () => {
    transfer({ v: convexToJson(['Sharks']) });
    await TestBed.inject(ApplicationRef).whenStable();

    const teams = create();
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    client.subscriptions[0].emit(['Jets']);
    expect(teams.value()).toEqual(['Jets']);
    expect(teams.isLoading()).toBe(false);
  });

  it('does not seed for an entry under a different key', () => {
    transfer({ v: convexToJson(['Sharks']) }, 'cvx:teams:list:{"leagueId":"b"}');
    const teams = create();
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);
  });

  it('does not use transferred entries for an args change (loading until the new emission)', () => {
    transfer({ v: convexToJson(['Sharks']) });
    transfer({ v: convexToJson(['Jets']) }, 'cvx:teams:list:{"leagueId":"b"}');
    const leagueId = signal('a');
    const teams = create(() => ({ leagueId: leagueId() }));
    expect(teams.value()).toEqual(['Sharks']);
    TestBed.tick();

    leagueId.set('b');
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    client.subscriptions[1].emit(['Live Jets']);
    expect(teams.value()).toEqual(['Live Jets']);
  });

  it('does not seed when skipToken args become ready after the application is stable', async () => {
    transfer({ v: convexToJson(['STALE server']) });
    const leagueId = signal<string | null>(null);
    const teams = create(() => {
      const id = leagueId();
      return id ? { leagueId: id } : skipToken;
    });
    TestBed.tick();
    await TestBed.inject(ApplicationRef).whenStable();

    leagueId.set('a');
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    expect(client.activeSubscriptions).toHaveLength(1);
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);
    client.subscriptions[0].emit(['Live Sharks']);
    expect(teams.value()).toEqual(['Live Sharks']);
    expect(teams.isLoading()).toBe(false);
  });

  it('does not seed when skipToken args become ready before the application is stable (an args change)', () => {
    transfer({ v: convexToJson(['STALE server']) });
    const leagueId = signal<string | null>(null);
    const teams = create(() => {
      const id = leagueId();
      return id ? { leagueId: id } : skipToken;
    });
    expect(teams.isLoading()).toBe(false);

    leagueId.set('a');
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);
    client.subscriptions[0].emit(['Live Sharks']);
    expect(teams.value()).toEqual(['Live Sharks']);
  });

  it('does not seed when skipToken args become ready before stable but value() is first read after stable', async () => {
    transfer({ v: convexToJson(['STALE server']) });
    const leagueId = signal<string | null>(null);
    const teams = create(() => {
      const id = leagueId();
      return id ? { leagueId: id } : skipToken;
    });
    leagueId.set('a');
    await TestBed.inject(ApplicationRef).whenStable();

    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);
  });

  it('does not seed when the args are first read after stable, even if they were ready at creation', async () => {
    transfer({ v: convexToJson(['Sharks']) });
    const teams = create();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(true);

    TestBed.tick();
    client.subscriptions[0].emit(['Live Sharks']);
    expect(teams.value()).toEqual(['Live Sharks']);
  });

  it('keeps the seed decided on the first read (inside the window) after the app becomes stable', async () => {
    transfer({ v: convexToJson(['Sharks']) });
    const teams = create();
    expect(teams.value()).toEqual(['Sharks']);
    await TestBed.inject(ApplicationRef).whenStable();
    TestBed.inject(TransferState).remove(makeStateKey(KEY));

    expect(teams.value()).toEqual(['Sharks']);
    expect(teams.isLoading()).toBe(false);
  });

  it('seeds nothing and stays idle for skipToken args', () => {
    transfer({ v: convexToJson(['Sharks']) });
    const teams = create(() => skipToken);
    expect(teams.value()).toBeUndefined();
    expect(teams.isLoading()).toBe(false);
  });
});
