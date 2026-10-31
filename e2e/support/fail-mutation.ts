import type { Page } from '@playwright/test';

/**
 * Answers every call of the named Convex mutation with a server error, as an unexpected failure
 * would, and passes everything else through. Register it before the page that calls it loads.
 */
export async function failMutation(page: Page, mutation: string): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (typeof message === 'string' && message.includes(`"${mutation}"`)) {
        const { requestId } = JSON.parse(message) as { requestId: number };
        ws.send(
          JSON.stringify({
            type: 'MutationResponse',
            requestId,
            success: false,
            result: 'Server Error',
            logLines: [],
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
}
