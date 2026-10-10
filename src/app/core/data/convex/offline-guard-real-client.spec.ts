import { TestBed } from '@angular/core/testing';
import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { wrapConvexClient } from './convex-client';
import {
  CONVEX_CLIENT,
  ConvexOfflineError,
  injectAction,
  injectMutation,
  type CallRef,
} from './index';

// The call-time offline guard (#88, ADR 0013 Decision 3A) against the real `ConvexClient` from
// `convex` 1.46, with only its WebSocket replaced. The other guard specs use the fake client, whose
// connection state is set by hand; these check that the real client reports a closed socket as
// disconnected, notifies the guard on reconnect, and that a refused change never reaches any socket,
// not even the one opened after the connection returns (nothing is queued and sent later).

const createTeam = makeFunctionReference<'mutation', { tag: string }, string>('teams:create');
const sendInvite = makeFunctionReference<'action', { tag: string }, string>('invites:send');

/** A WebSocket the test opens and drops by hand; it records every frame the client sends. */
class TestSocket {
  static instances: TestSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(readonly url: string) {
    TestSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  /** As in a browser, `onclose` follows `close()` asynchronously. */
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: '' }));
  }
  /** The server accepts the connection. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  /** The network drops the connection (abnormal closure). */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const latestSocket = () => TestSocket.instances[TestSocket.instances.length - 1];

/** Mutation and action frames sent on any socket, as `<type>:<tag>`. */
function changeFrames(): string[] {
  return TestSocket.instances.flatMap((socket) =>
    socket.sent
      .map((data) => JSON.parse(data) as { type: string; args?: { tag?: string }[] })
      .filter((message) => message.type === 'Mutation' || message.type === 'Action')
      .map((message) => `${message.type}:${message.args?.[0]?.tag ?? ''}`),
  );
}

describe('offline guard with the real ConvexClient (convex 1.46)', () => {
  let convex: ConvexClient;
  let mutation: CallRef<{ tag: string }, string>;
  let action: CallRef<{ tag: string }, string>;

  beforeEach(async () => {
    vi.useFakeTimers();
    TestSocket.instances = [];
    convex = new ConvexClient('https://happy-otter-123.convex.cloud', {
      webSocketConstructor: TestSocket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
      logger: false,
    });
    TestBed.configureTestingModule({
      providers: [{ provide: CONVEX_CLIENT, useValue: wrapConvexClient(convex) }],
    });
    mutation = TestBed.runInInjectionContext(() => injectMutation(createTeam));
    action = TestBed.runInInjectionContext(() => injectAction(sendInvite));
    latestSocket().open();
    await vi.advanceTimersByTimeAsync(0);
    expect(convex.connectionState().isWebSocketConnected).toBe(true);
  });

  afterEach(async () => {
    const closing = convex.close();
    // A socket still connecting is never closed by the client; it waits for `onclose`.
    const last = latestSocket();
    if (last.readyState === 0) last.close();
    await closing;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends a change while connected (control: the frames are visible to the test)', async () => {
    void mutation.run({ tag: 'online' }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(changeFrames()).toEqual(['Mutation:online']);
  });

  it('refuses a change after the socket drops, and never sends it on the socket opened after reconnect', async () => {
    const dropped = latestSocket();
    dropped.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(convex.connectionState().isWebSocketConnected).toBe(false);
    expect(window.navigator.onLine).toBe(true);

    const refused = Promise.allSettled([
      mutation.run({ tag: 'dropped-m' }),
      action.run({ tag: 'dropped-a' }),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    const [m, a] = await refused;
    expect(m.status === 'rejected' && m.reason).toBeInstanceOf(ConvexOfflineError);
    expect(a.status === 'rejected' && a.reason).toBeInstanceOf(ConvexOfflineError);
    expect(mutation.error()).toBeInstanceOf(ConvexOfflineError);
    expect(action.error()).toBeInstanceOf(ConvexOfflineError);

    // The client reconnects on its own back-off; the new socket must carry no refused change.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latestSocket()).not.toBe(dropped);
    latestSocket().open();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(convex.connectionState().isWebSocketConnected).toBe(true);
    expect(changeFrames()).toEqual([]);

    void mutation.run({ tag: 'after' }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(changeFrames()).toEqual(['Mutation:after']);
  });

  it('refuses a change while the browser reports offline with the socket still open', async () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));

    const refused = Promise.allSettled([
      mutation.run({ tag: 'offline-m' }),
      action.run({ tag: 'offline-a' }),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    const [m, a] = await refused;
    expect(m.status === 'rejected' && m.reason).toBeInstanceOf(ConvexOfflineError);
    expect(a.status === 'rejected' && a.reason).toBeInstanceOf(ConvexOfflineError);

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changeFrames()).toEqual([]);
  });

  it('sends a change exactly once when the socket returns within 3 s', async () => {
    latestSocket().drop();
    await vi.advanceTimersByTimeAsync(0);

    const run = mutation.run({ tag: 'retry' });
    run.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(changeFrames()).toEqual([]);

    // convex 1.46 reconnects at once on the browser's `online` event.
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    latestSocket().open();
    await vi.advanceTimersByTimeAsync(0);
    expect(changeFrames()).toEqual(['Mutation:retry']);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(changeFrames()).toEqual(['Mutation:retry']);
    expect(mutation.error()).toBeUndefined();
  });
});
