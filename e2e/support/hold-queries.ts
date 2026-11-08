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
  heldQueriesAnswered: () => boolean;
  release: () => void;
}

const addedChanges = (message: string | Buffer): Change[] =>
  changes(message).filter((change) => change.type === 'Add' && change.udfPath);

// Client frames after the first held one are kept too, because the query-set versions must stay in order.
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
      const added = addedChanges(message);
      const held = added.filter((change) => udfPaths.includes(change.udfPath ?? ''));
      const others = added.filter((change) => !udfPaths.includes(change.udfPath ?? ''));
      if (!holding && held.length === 0) return server.send(message);
      if (others.length > 0) {
        failure ??= new Error(
          `holdSubscriptions: a frame adds ${others.map((change) => change.udfPath).join(', ')} while the held queries are ${udfPaths.join(', ')}, so the held queries cannot be split from them`,
        );
        // Forwarded, so the page still shows and release() names the queries instead of a timeout.
        if (!holding) return server.send(message);
      }
      for (const change of held) pendingQueryIds.add(change.queryId);
      holding = true;
      kept.push(message);
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
    heldQueriesAnswered: () => released && pendingQueryIds.size === 0,
    release: () => {
      if (failure) throw failure;
      if (!holding) throw new Error('holdSubscriptions: no frame adding the held queries was kept');
      release();
    },
  };
}
