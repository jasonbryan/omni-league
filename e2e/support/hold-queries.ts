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
  hold: () => void;
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
