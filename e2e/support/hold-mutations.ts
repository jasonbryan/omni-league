import type { Page } from '@playwright/test';

export interface HeldMutations {
  /** Mutations sent from now on wait until `release`. */
  hold: () => void;
  release: () => void;
}

// Register it before the page that sends the mutation loads.
export async function holdMutations(page: Page): Promise<HeldMutations> {
  let gate: Promise<void> = Promise.resolve();
  let release: () => void = () => undefined;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage(async (message) => {
      if (typeof message === 'string' && message.includes('"Mutation"')) await gate;
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return {
    hold: () => {
      gate = new Promise<void>((resolve) => (release = resolve));
    },
    release: () => release(),
  };
}
