import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeFunctionReference, type FunctionArgs } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  CONVEX_CLIENT,
  CONVEX_CLIENT_FACTORY,
  CONVEX_URL,
  ConvexNotConfiguredError,
  ConvexServerCallError,
  injectAction,
  injectMutation,
  provideConvex,
  type CallRef,
} from './index';
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
