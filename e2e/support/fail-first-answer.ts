import type { Page, WebSocketRoute } from '@playwright/test';

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

interface Change {
  type: string;
  queryId: number;
  udfPath?: string;
  errorMessage?: string;
  logLines?: string[];
  value?: unknown;
}

interface Frame {
  modifications?: Change[];
}

const parse = (message: string | Buffer): Frame => JSON.parse(String(message)) as Frame;
const changesOf = (frame: Frame): Change[] => frame.modifications ?? [];

export interface FailedFirstAnswer {
  reconnect: () => Promise<void>;
}

export async function failFirstAnswer(page: Page, udfPath: string): Promise<FailedFirstAnswer> {
  let failed = false;
  let current: WebSocketRoute | undefined;
  await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
    current = ws;
    const server = ws.connectToServer();
    const queryIds = new Set<number>();
    ws.onMessage((message) => {
      for (const change of changesOf(parse(message))) {
        if (change.type === 'Add' && change.udfPath === udfPath) queryIds.add(change.queryId);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = parse(message);
      const answersQuery = changesOf(frame).some(
        (change) => change.type === 'QueryUpdated' && queryIds.has(change.queryId),
      );
      if (failed || !answersQuery) {
        ws.send(message);
        return;
      }
      failed = true;
      frame.modifications = changesOf(frame).map((change) =>
        change.type === 'QueryUpdated' && queryIds.has(change.queryId)
          ? { ...change, type: 'QueryFailed', errorMessage: 'forced failure', logLines: [] }
          : change,
      );
      ws.send(JSON.stringify(frame));
    });
  });
  return {
    reconnect: async () => {
      await current?.close();
    },
  };
}
