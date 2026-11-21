import type { APIResponse, Page, Request } from '@playwright/test';
import type { ConsoleGuard } from './console-guard';
import { expect } from './fixtures';

const SCRIPT = /\.js(\?|$)/;

const isMainDocument = (page: Page, request: Request) =>
  request.isNavigationRequest() && request.frame() === page.mainFrame();

const pathAndQuery = (url: string) => {
  const { pathname, search } = new URL(url);
  return pathname + search;
};

export function documentRequests(page: Page): readonly string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (isMainDocument(page, request)) requests.push(pathAndQuery(request.url()));
  });
  return requests;
}

const BOOTSTRAP_LOG = 'Angular is running in development mode';

export interface HeldPage {
  release: () => void;
}

/**
 * Loads `path` and holds the chunk that defines `pageClass`, which the router waits for before
 * the page is stable. The application has started and the page is still as the server rendered it,
 * so Angular queues what the visitor does until the chunk is released. Holding `main.js` would not
 * do: a navigation the visitor starts first stops a script that has not run yet.
 */
export async function gotoUnhydrated(
  page: Page,
  consoleGuard: Pick<ConsoleGuard, 'logMessages'>,
  path: string,
  pageClass: string,
): Promise<HeldPage> {
  const definesPage = new RegExp(`\\bvar ${pageClass} = class\\b`);
  let holding = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(SCRIPT, async (route) => {
    let response: APIResponse;
    let body: string;
    try {
      response = await route.fetch();
      body = await response.text();
    } catch {
      // The new document replaced the page, which disposes the responses still being read.
      return;
    }
    if (definesPage.test(body)) {
      holding = true;
      await released;
    }
    await route.fulfill({ response, body }).catch(() => undefined);
  });
  await page.goto(path, { waitUntil: 'commit' });
  await expect
    .poll(() => holding, {
      message: `expected the request for the chunk that defines ${pageClass}`,
    })
    .toBe(true);
  await expect
    .poll(() => consoleGuard.logMessages.some((text) => text.includes(BOOTSTRAP_LOG)), {
      message: `expected the dev-mode log "${BOOTSTRAP_LOG}"`,
    })
    .toBe(true);
  return { release };
}

export interface HeldDocument {
  requests: readonly string[];
  isRequested: () => boolean;
  release: () => void;
}

export async function holdDocument(page: Page, target: string): Promise<HeldDocument> {
  const requests = documentRequests(page);
  let requested = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname + url.search === target,
    async (route) => {
      if (route.request().isNavigationRequest()) {
        requested = true;
        await released;
      }
      await route.fallback();
    },
  );
  return { requests, isRequested: () => requested, release };
}

const SETTLE_MS = 1_000;

/**
 * Time for the router to start a navigation the page should not make. Nothing in the old
 * document can be read while the new one is held, and the absence of a navigation has no event.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
}
