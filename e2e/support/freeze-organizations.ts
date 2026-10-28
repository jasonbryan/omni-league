import type { Page } from '@playwright/test';

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

interface Modification {
  type: string;
  queryId: number;
  udfPath?: string;
}

/** Other specs seed organizations while one runs, and a live update between the read and a Tab walk would change the list under the check. */
export async function freezeOrganizations(page: Page): Promise<void> {
  const queryIds = new Set<number>();
  const answered = new Set<number>();
  await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const { modifications = [] } = JSON.parse(String(message)) as {
        modifications?: Modification[];
      };
      for (const { type, queryId, udfPath } of modifications) {
        if (type === 'Add' && udfPath === 'search:organizations') queryIds.add(queryId);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { modifications?: Modification[] };
      if (!frame.modifications) {
        ws.send(message);
        return;
      }
      const kept = frame.modifications.filter(({ type, queryId }) => {
        if (type !== 'QueryUpdated' || !queryIds.has(queryId)) return true;
        if (answered.has(queryId)) return false;
        answered.add(queryId);
        return true;
      });
      ws.send(JSON.stringify({ ...frame, modifications: kept }));
    });
  });
}
