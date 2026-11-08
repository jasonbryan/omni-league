import type { Page } from '@playwright/test';

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

interface Change {
  type: string;
  queryId: number;
  udfPath?: string;
}

const changes = (message: string | Buffer): Change[] =>
  (JSON.parse(String(message)) as { modifications?: Change[] }).modifications ?? [];

// A refused mutation changes no query result, so it is not part of the transitions that wait.
const isRefusedMutation = (message: string | Buffer): boolean => {
  const { type, success } = JSON.parse(String(message)) as { type?: string; success?: boolean };
  return type === 'MutationResponse' && success === false;
};

export interface HeldQueries {
  isHolding: () => boolean;
  release: () => void;
  watchNewSubscriptions: () => void;
  holdNextAnswer: () => void;
}

// Frames after a held answer are kept too, because Convex applies transitions in order.
export async function holdQueries(
  page: Page,
  udfPaths: readonly string[],
  {
    watchFromStart = true,
    holdFromStart = true,
  }: { watchFromStart?: boolean; holdFromStart?: boolean } = {},
): Promise<HeldQueries> {
  let watching = watchFromStart;
  let armed = holdFromStart;
  const queryIds = new Set<number>();
  const kept: (string | Buffer)[] = [];
  let holding = false;
  let released = false;
  let release: () => void = () => undefined;
  await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      for (const change of changes(message)) {
        if (
          watching &&
          change.type === 'Add' &&
          change.udfPath &&
          udfPaths.includes(change.udfPath)
        ) {
          queryIds.add(change.queryId);
        }
      }
      server.send(message);
    });
    release = () => {
      released = true;
      holding = false;
      for (const frame of kept.splice(0)) ws.send(frame);
    };
    server.onMessage((message) => {
      const answersHeldQuery = changes(message).some(
        (change) => change.type === 'QueryUpdated' && queryIds.has(change.queryId),
      );
      if (answersHeldQuery && armed && !released) holding = true;
      if (holding && !isRefusedMutation(message)) kept.push(message);
      else ws.send(message);
    });
  });
  return {
    isHolding: () => holding,
    release: () => release(),
    watchNewSubscriptions: () => {
      watching = true;
    },
    holdNextAnswer: () => {
      armed = true;
    },
  };
}

export interface HeldSubscriptions {
  isHolding: () => boolean;
  /** True once every held query has been answered after the release. */
  isAnswered: () => boolean;
  /** Sends the kept frames in order, or throws the error that the socket handler recorded. */
  release: () => void;
}

const addedPaths = (message: string | Buffer): string[] =>
  changes(message).flatMap((change) =>
    change.type === 'Add' && change.udfPath ? [change.udfPath] : [],
  );

/**
 * Holds the client's subscriptions to `udfPaths`, so the server answers the other queries alone.
 * The first frame that adds one of them and every client frame after it are kept, which keeps the
 * query-set versions in order.
 */
export async function holdSubscriptions(
  page: Page,
  udfPaths: readonly string[],
): Promise<HeldSubscriptions> {
  const pendingQueryIds = new Set<number>();
  const kept: (string | Buffer)[] = [];
  let holding = false;
  let released = false;
  // An exception thrown in a socket handler does not fail the test, so release() rethrows it.
  let failure: Error | undefined;
  let release: () => void = () => undefined;
  await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (released) return server.send(message);
      if (!holding) {
        const held = changes(message).filter(
          (change) => change.type === 'Add' && change.udfPath && udfPaths.includes(change.udfPath),
        );
        if (held.length > 0) {
          const others = addedPaths(message).filter((path) => !udfPaths.includes(path));
          if (others.length > 0) {
            failure ??= new Error(
              `holdSubscriptions: one frame adds ${others.join(', ')} with ${held.map((change) => change.udfPath).join(', ')}, so the held queries cannot be split from them`,
            );
            return server.send(message);
          }
          holding = true;
          for (const change of held) pendingQueryIds.add(change.queryId);
        }
      }
      if (holding) kept.push(message);
      else server.send(message);
    });
    server.onMessage((message) => {
      if (released) {
        for (const change of changes(message)) {
          if (change.type === 'QueryUpdated') pendingQueryIds.delete(change.queryId);
        }
      }
      ws.send(message);
    });
    release = () => {
      released = true;
      holding = false;
      for (const frame of kept.splice(0)) server.send(frame);
    };
  });
  return {
    isHolding: () => holding,
    isAnswered: () => released && pendingQueryIds.size === 0,
    release: () => {
      if (failure) throw failure;
      if (!holding) throw new Error('holdSubscriptions: no frame adding the held queries was kept');
      release();
    },
  };
}
