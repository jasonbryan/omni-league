import type { Page } from '@playwright/test';

export interface HeldMutations {
  hold: () => void;
  release: () => void;
}

function isMutation(message: string | Buffer): boolean {
  if (typeof message !== 'string') return false;
  try {
    return (JSON.parse(message) as { type?: string }).type === 'Mutation';
  } catch {
    return false;
  }
}

// Register it before the page that sends the mutation loads.
export async function holdMutations(page: Page): Promise<HeldMutations> {
  let gate: Promise<void> = Promise.resolve();
  let release: () => void = () => undefined;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage(async (message) => {
      if (isMutation(message)) await gate;
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
