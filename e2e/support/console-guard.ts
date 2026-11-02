import type { ConsoleMessage, Page, Request } from '@playwright/test';

export type ExpectedDocumentStatus = 404;

/**
 * By URL path on any origin: for example a 422 from `/api/auth/sign-up/email` when the email
 * already has an account. A string matches the whole path, a RegExp anywhere in it.
 */
export interface ExpectedFailedRequest {
  status: number;
  path: string | RegExp;
}

export interface ConsoleGuardOptions {
  expectedDocumentStatus?: ExpectedDocumentStatus;
  expectedConvexErrors?: readonly string[];
  expectedFailedRequests?: readonly ExpectedFailedRequest[];
  /** `console.warn` messages the test expects: a string matches the start, a RegExp anywhere. */
  expectedConsoleWarnings?: readonly (string | RegExp)[];
}

export interface VerifyOptions {
  skipped?: boolean;
}

const DOCUMENT_404_PREFIX = 'Failed to load resource: the server responded with a status of 404';
const FAILED_RESOURCE = /^Failed to load resource: the server responded with a status of (\d{3})\b/;
const HYDRATED_LOG = /Angular hydrated \d+ component\(s\)/;
/**
 * WebKit logs an auth fetch it cancels for a leaving document as an access-control failure, which
 * Playwright reports as a page error; the app catches the failed fetch. The same text with no
 * navigation in flight is a real refusal (a trusted-origins mistake), so it still fails.
 */
/**
 * Offline, a lazy page that is not on the device cannot load: the app shows the not-saved view, which
 * the tests assert, and also loads that view's chunk once after startup, which a test that goes offline
 * at once can cut off. Allowed only for a chunk, and only with the text each engine logs for a request
 * the offline browser refused (Chromium) or dropped (WebKit).
 */
const OFFLINE_CHUNK_REFUSAL = new Set([
  'Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
  'Failed to load resource: WebKit encountered an internal error',
]);
const CHUNK_PATH = /^\/chunk-[\w-]+\.js$/;
const CANCELLED_AUTH_FETCH =
  /^Fetch API cannot load https?:\/\/[^/\s]+\/api\/auth\/(?:convex\/token|get-session) due to access control checks\.$/;

function isOfflineChunkRefusal(text: string, url: string): boolean {
  if (!OFFLINE_CHUNK_REFUSAL.has(text) || !url) return false;
  try {
    return CHUNK_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Angular's development warnings come with a code (`NG0505`) and without one (`Unexpected state: no
 * hydration info available …`), so no text rule tells them apart from other warnings, and every
 * warning counts. `log` and `info` are ignored (they are kept only for the hydration assertion).
 *
 * A test that skips itself after `test.use()` (for example a local-only test on a remote run) is
 * not failed for unused allowances of any kind.
 */
export class ConsoleGuard {
  private readonly failures: string[] = [];
  private readonly logs: string[] = [];
  private readonly usedConvexAllowances = new Set<string>();
  private readonly expectedConvexErrors: readonly string[];
  private readonly expectedFailedRequests: readonly ExpectedFailedRequest[];
  private readonly usedRequestAllowances = new Set<ExpectedFailedRequest>();
  private readonly usedWarningAllowances = new Set<string | RegExp>();
  private readonly expectedConsoleWarnings: readonly (string | RegExp)[];
  private readonly expectedDocumentStatus: ExpectedDocumentStatus | undefined;
  private readonly documents = new WeakMap<Page, { url: string; status: number }>();

  constructor(options: ConsoleGuardOptions = {}) {
    const status = options.expectedDocumentStatus;
    if (status !== undefined && status !== 404) {
      throw new Error(`expectedDocumentStatus takes only 404; got ${String(status)}`);
    }
    this.expectedDocumentStatus = status;
    this.expectedConvexErrors = options.expectedConvexErrors ?? [];
    this.expectedFailedRequests = options.expectedFailedRequests ?? [];
    this.expectedConsoleWarnings = options.expectedConsoleWarnings ?? [];
  }

  attach(page: Page): void {
    const leaving = this.trackLeaving(page);
    page.on('pageerror', (error) => {
      // Playwright's WebKit backend keeps the logged text only as the stack's first line.
      const text = error.stack?.split('\n', 1)[0] ?? '';
      if (leaving() && CANCELLED_AUTH_FETCH.test(text)) return;
      this.failures.push(`pageerror: ${error.stack ?? error.message}`);
    });
    page.on('console', (message) => this.onConsole(page, message));
    page.on('response', (response) => {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        this.documents.set(page, {
          url: withoutFragment(response.url()),
          status: response.status(),
        });
      }
    });
  }

  /**
   * True from a main-frame navigation request until the main frame commits that navigation's URL, or
   * the navigation fails or answers with no content. A same-document `history.replaceState` on the
   * old document also fires `framenavigated`, so the URL must match.
   */
  private trackLeaving(page: Page): () => boolean {
    let pending: string | null = null;
    const isMainNavigation = (request: Request) =>
      request.isNavigationRequest() && request.frame() === page.mainFrame();
    page.on('request', (request) => {
      if (isMainNavigation(request)) pending = withoutFragment(request.url());
    });
    page.on('requestfailed', (request) => {
      if (isMainNavigation(request) && withoutFragment(request.url()) === pending) pending = null;
    });
    // Chromium reports a 204 or 205 navigation as finished, with no failure and no commit.
    page.on('response', (response) => {
      const request = response.request();
      const noContent = response.status() === 204 || response.status() === 205;
      if (noContent && isMainNavigation(request) && withoutFragment(request.url()) === pending) {
        pending = null;
      }
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && withoutFragment(frame.url()) === pending) pending = null;
    });
    return () => pending !== null;
  }

  get logMessages(): readonly string[] {
    return this.logs;
  }

  get hydrated(): boolean {
    return this.logs.some((text) => HYDRATED_LOG.test(text));
  }

  /**
   * With `skipped` (the test skipped itself, so it may never reach what it allowed) unused
   * allowances of every kind (Convex errors, failed requests, console warnings) are not reported;
   * console failures still are.
   */
  problems({ skipped = false }: VerifyOptions = {}): string[] {
    if (skipped) return [...this.failures];
    const unusedConvex = this.expectedConvexErrors
      .filter((name) => !this.usedConvexAllowances.has(name))
      .map(
        (name) =>
          `expectedConvexErrors entry "${name}" was not used: no [CONVEX M(${name})] or ` +
          `[CONVEX A(${name})] console error was logged; remove the stale entry`,
      );
    const unusedRequests = this.expectedFailedRequests
      .filter((entry) => !this.usedRequestAllowances.has(entry))
      .map(
        (entry) =>
          `expectedFailedRequests entry ${entry.status} ${String(entry.path)} was not used: no request ` +
          'with that status and path failed; remove the stale entry',
      );
    const unusedWarnings = this.expectedConsoleWarnings
      .filter((entry) => !this.usedWarningAllowances.has(entry))
      .map((entry) =>
        typeof entry === 'string'
          ? `expectedConsoleWarnings entry "${entry}" was not used: no console.warn started with ` +
            `it; remove the stale entry`
          : `expectedConsoleWarnings entry ${String(entry)} was not used: no console.warn ` +
            `matched it; remove the stale entry`,
      );
    return [...this.failures, ...unusedConvex, ...unusedRequests, ...unusedWarnings];
  }

  verify(options: VerifyOptions = {}): void {
    const problems = this.problems(options);
    if (problems.length > 0) {
      throw new Error(
        `Console fixture: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
    }
  }

  private onConsole(page: Page, message: ConsoleMessage): void {
    const type = message.type();
    const text = message.text();
    if (type === 'log' || type === 'info') {
      this.logs.push(text);
      return;
    }
    const url = message.location().url;
    const at = url ? ` (at ${url})` : '';
    if (type === 'warning') {
      if (this.matchWarningAllowance(text)) return;
      this.failures.push(`console.warn: ${text}${at}`);
      return;
    }
    if (type !== 'error') return;
    if (this.isExpectedDocument404(page, message, text)) return;
    if (this.matchConvexAllowance(text)) return;
    if (this.matchRequestAllowance(text, url)) return;
    if (isOfflineChunkRefusal(text, url)) return;
    this.failures.push(`console.error: ${text}${at}`);
  }

  private matchWarningAllowance(text: string): boolean {
    // `search` ignores `lastIndex`, so a RegExp with the `g` flag matches the same way every time.
    const entry = this.expectedConsoleWarnings.find((e) =>
      typeof e === 'string' ? text.startsWith(e) : text.search(e) !== -1,
    );
    if (entry === undefined) return false;
    this.usedWarningAllowances.add(entry);
    return true;
  }

  private isExpectedDocument404(page: Page, message: ConsoleMessage, text: string): boolean {
    if (this.expectedDocumentStatus !== 404 || !text.startsWith(DOCUMENT_404_PREFIX)) return false;
    const url = withoutFragment(message.location().url);
    if (url === withoutFragment(page.mainFrame().url())) return true;
    // WebKit logs the message before `page.mainFrame().url()` moves to the new document, so the
    // main frame's latest navigation response (the 404 document itself) is accepted too.
    const document = this.documents.get(page);
    return document?.status === 404 && document.url === url;
  }

  private matchRequestAllowance(text: string, url: string): boolean {
    const status = FAILED_RESOURCE.exec(text)?.[1];
    if (status === undefined || !url) return false;
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return false;
    }
    // `search` ignores `lastIndex`, so a RegExp with the `g` flag matches the same way every time.
    const entry = this.expectedFailedRequests.find(
      (e) =>
        String(e.status) === status &&
        (typeof e.path === 'string' ? e.path === path : path.search(e.path) !== -1),
    );
    if (entry === undefined) return false;
    this.usedRequestAllowances.add(entry);
    return true;
  }

  private matchConvexAllowance(text: string): boolean {
    // Only mutations (M) and actions (A): `Q(` would also hide "Could not parse console.log".
    const name = this.expectedConvexErrors.find(
      (n) => text.startsWith(`[CONVEX M(${n})] `) || text.startsWith(`[CONVEX A(${n})] `),
    );
    if (name === undefined) return false;
    this.usedConvexAllowances.add(name);
    return true;
  }
}
