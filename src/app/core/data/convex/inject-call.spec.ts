import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeFunctionReference, type FunctionArgs } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  ConvexNotConfiguredError,
  ConvexOfflineError,
  ConvexServerCallError,
  injectAction,
  injectMutation,
  provideConvex,
  type CallRef,
} from './index';
import { ChangesInFlight } from '../../changes-in-flight';
import { FakeConvexClient } from './testing/fake-convex-client';

const createTeam = makeFunctionReference<'mutation', { name: string }, string>('teams:create');
const sendInvite = makeFunctionReference<'action', { name: string }, string>('invites:send');
type Args = FunctionArgs<typeof createTeam>;

const helpers = [
  { kind: 'mutation', name: 'teams:create', create: () => injectMutation(createTeam) },
  { kind: 'action', name: 'invites:send', create: () => injectAction(sendInvite) },
] as const;

for (const helper of helpers) {
  describe(`inject${helper.kind === 'mutation' ? 'Mutation' : 'Action'} (fake client)`, () => {
    let client: FakeConvexClient;
    let ref: CallRef<Args, string>;

    beforeEach(() => {
      client = new FakeConvexClient();
      TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
      ref = TestBed.runInInjectionContext(helper.create);
    });

    it('is pending while the call runs and resolves with the result', async () => {
      expect(ref.pending()).toBe(false);
      const result = ref.run({ name: 'Sharks' });

      expect(ref.pending()).toBe(true);
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0]).toMatchObject({
        kind: helper.kind,
        name: helper.name,
        args: { name: 'Sharks' },
      });

      client.calls[0].resolve('team1');
      await expect(result).resolves.toBe('team1');
      expect(ref.pending()).toBe(false);
      expect(ref.error()).toBeUndefined();
    });

    it('holds the error and rejects with it when the call rejects', async () => {
      const result = ref.run({ name: 'Sharks' });
      const failure = new ConvexError('name taken');
      client.calls[0].reject(failure);

      await expect(result).rejects.toBe(failure);
      expect(ref.error()).toBe(failure);
      expect(ref.pending()).toBe(false);
    });

    it('keeps the error while a later call runs and clears it when that call resolves', async () => {
      const first = ref.run({ name: 'Sharks' });
      client.calls[0].reject(new Error('offline'));
      await expect(first).rejects.toThrow('offline');

      const second = ref.run({ name: 'Sharks' });
      expect(ref.error()?.message).toBe('offline');
      client.calls[1].resolve('team1');
      await second;

      expect(ref.error()).toBeUndefined();
    });

    it('counts as a change in flight until it settles, whether it resolves or rejects', async () => {
      const changes = TestBed.inject(ChangesInFlight);
      const first = ref.run({ name: 'Sharks' });
      expect(changes.active()).toBe(true);

      client.calls[0].resolve('team1');
      await first;
      expect(changes.active()).toBe(false);

      const second = ref.run({ name: 'Jets' });
      expect(changes.active()).toBe(true);
      client.calls[1].reject(new Error('offline'));
      await expect(second).rejects.toThrow('offline');
      expect(changes.active()).toBe(false);
    });

    it('stays pending until the last of two overlapping calls settles', async () => {
      const first = ref.run({ name: 'Sharks' });
      const second = ref.run({ name: 'Jets' });

      client.calls[0].resolve('team1');
      await first;
      expect(ref.pending()).toBe(true);

      client.calls[1].resolve('team2');
      await second;
      expect(ref.pending()).toBe(false);
    });
  });
}

describe('mutation and action helpers without a client', () => {
  const factory = vi.fn<(url: string) => FakeConvexClient>();

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

  const cases = [
    { platform: 'browser', url: null, error: ConvexNotConfiguredError },
    {
      platform: 'server',
      url: 'https://happy-otter-123.convex.cloud',
      error: ConvexServerCallError,
    },
    { platform: 'server', url: null, error: ConvexServerCallError },
  ] as const;

  for (const { platform, url, error } of cases) {
    for (const helper of helpers) {
      it(`${helper.kind} on the ${platform} with URL ${url ?? 'none'} rejects with ${error.name}`, async () => {
        factory.mockReset();
        const consoleSpies = (['error', 'warn', 'info', 'log'] as const).map((m) =>
          vi.spyOn(console, m).mockImplementation(() => undefined),
        );
        configure(platform, url);
        const ref = TestBed.runInInjectionContext(helper.create);
        const pendingSeen: boolean[] = [];

        const result = ref.run({ name: 'Sharks' });
        pendingSeen.push(ref.pending());

        await expect(result).rejects.toBeInstanceOf(error);
        expect(ref.error()).toBeInstanceOf(error);
        expect(ref.error()?.name).toBe(error.name);
        expect(pendingSeen).toEqual([false]);
        expect(ref.pending()).toBe(false);
        expect(factory).not.toHaveBeenCalled();
        for (const spy of consoleSpies) {
          expect(spy).not.toHaveBeenCalled();
          spy.mockRestore();
        }
      });
    }
  }
});

describe('mutation and action helpers on the server with a client present', () => {
  for (const helper of helpers) {
    it(`${helper.kind} rejects with ConvexServerCallError and calls no client method`, async () => {
      const client = new FakeConvexClient();
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'server' },
          { provide: CONVEX_CLIENT, useValue: client },
        ],
      });
      const ref = TestBed.runInInjectionContext(helper.create);

      const result = ref.run({ name: 'Sharks' });
      expect(ref.pending()).toBe(false);

      await expect(result).rejects.toBeInstanceOf(ConvexServerCallError);
      expect(ref.error()).toBeInstanceOf(ConvexServerCallError);
      expect(client.calls).toEqual([]);
      expect(client.subscriptions).toEqual([]);
      expect(client.lifecycle).toEqual([]);
    });
  }
});

describe('mutation and action helpers while offline (call-time guard)', () => {
  let client: FakeConvexClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeConvexClient();
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const helper of helpers) {
    it(`${helper.kind} rejects with ConvexOfflineError when the socket stays down for 3 s, and never calls the client`, async () => {
      const ref = TestBed.runInInjectionContext(helper.create);
      const listenersBefore = client.connectionStateListeners;
      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(1_000);

      const result = ref.run({ name: 'Sharks' });
      const settled = vi.fn();
      result.then(settled, settled);
      expect(ref.pending()).toBe(true);

      await vi.advanceTimersByTimeAsync(2_900);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);

      await expect(result).rejects.toBeInstanceOf(ConvexOfflineError);
      expect(ref.error()).toBeInstanceOf(ConvexOfflineError);
      expect(ref.error()?.name).toBe('ConvexOfflineError');
      expect(ref.pending()).toBe(false);

      client.setConnected(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.calls).toEqual([]);
      expect(client.connectionStateListeners).toBe(listenersBefore);
    });

    it(`${helper.kind} rejects with ConvexOfflineError while navigator.onLine stays false for 3 s, with the socket reported connected`, async () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      const ref = TestBed.runInInjectionContext(helper.create);

      const result = ref.run({ name: 'Sharks' });
      const rejected = expect(result).rejects.toBeInstanceOf(ConvexOfflineError);
      await vi.advanceTimersByTimeAsync(3_000);

      await rejected;
      expect(ref.error()).toBeInstanceOf(ConvexOfflineError);
      expect(client.calls).toEqual([]);
    });

    it(`${helper.kind} calls the client once and resolves when the socket reconnects 1 s after run()`, async () => {
      const ref = TestBed.runInInjectionContext(helper.create);
      client.setConnected(false);

      const result = ref.run({ name: 'Sharks' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(client.calls).toEqual([]);

      client.setConnected(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0]).toMatchObject({ kind: helper.kind, args: { name: 'Sharks' } });
      client.calls[0].resolve('team1');

      await expect(result).resolves.toBe('team1');
      expect(ref.error()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.calls).toHaveLength(1);
    });

    it(`${helper.kind} calls the client when the browser comes back online within 3 s`, async () => {
      const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      const ref = TestBed.runInInjectionContext(helper.create);

      const result = ref.run({ name: 'Sharks' });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(client.calls).toEqual([]);

      onLine.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(client.calls).toHaveLength(1);
      client.calls[0].resolve('team1');
      await expect(result).resolves.toBe('team1');
    });
  }
});
