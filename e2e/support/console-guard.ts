import type { ConsoleMessage, Page } from '@playwright/test';

/** Document status a test may expect; only 404 is supported (#23). */
export type ExpectedDocumentStatus = 404;

/**
 * A request a test expects to fail with this HTTP status, by URL path on any origin (#62): for
 * example a 422 from `/api/auth/sign-up/email` when the email already has an account.
 */
export interface ExpectedFailedRequest {
  status: number;
  path: string;
}

export interface ConsoleGuardOptions {
  /** Ignore the page's own "Failed to load resource … 404" message (and nothing else). */
  expectedDocumentStatus?: ExpectedDocumentStatus;
  /** Convex function names (`module:function`) whose rejected mutation or action may log. */
  expectedConvexErrors?: readonly string[];
  /** Requests whose own "Failed to load resource" message may log (each must happen). */
  expectedFailedRequests?: readonly ExpectedFailedRequest[];
  /** `console.warn` messages the test expects: a string matches the start, a RegExp anywhere. */
  expectedConsoleWarnings?: readonly (string | RegExp)[];
}

export interface VerifyOptions {
  /** The test skipped itself (`test.skip()` in its body): unused allowances are not problems. */
  skipped?: boolean;
}

const DOCUMENT_404_PREFIX = 'Failed to load resource: the server responded with a status of 404';
const FAILED_RESOURCE = /^Failed to load resource: the server responded with a status of (\d{3})\b/;
const HYDRATED_LOG = /Angular hydrated \d+ component\(s\)/;

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Console rules of ADR 0005 for one test. A test fails on:
 * - any uncaught page error (`pageerror`);
 * - any `console` message of type `error` (NG0500 to NG0504 included);
 * - any `console` message of type `warning`. Angular's development warnings come with a code
 *   (`NG0505`) and without one (`Unexpected state: no hydration info available …`, #94), so no
 *   text rule tells them apart from other warnings, and every warning counts.
 * `log` and `info` are ignored (they are kept only for the hydration assertion).
 *
 * Three opt-in, per-test allowances (see the fixture options in `fixtures.ts`):
 * - `expectedDocumentStatus: 404` ignores exactly the main document's own 404 resource message;
 * - `expectedConvexErrors` ignores `[CONVEX M(<name>)] ` / `[CONVEX A(<name>)] ` for listed names,
 *   and fails the test if a listed name never produced such a message;
 * - `expectedFailedRequests` ignores the resource message of a request with a listed status and
 *   URL path, and fails the test if a listed request never produced one;
 * - `expectedConsoleWarnings` ignores a warning that starts with a listed string or matches a
 *   listed RegExp, and fails the test if an entry matched no warning. Each entry needs a comment
 *   linking the issue that removes the warning.
 * A test that skips itself after `test.use()` (for example a local-only test on a remote run) is not
 * failed for unused allowances of any kind.
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
  /** Latest main-frame document response per page (URL without fragment, status). */
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

  /** Starts listening on a page. Call before the page navigates. */
  attach(page: Page): void {
    page.on('pageerror', (error) => {
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

  /** `log`/`info` texts seen so far, in order (for the hydration assertion). */
  get logMessages(): readonly string[] {
    return this.logs;
  }

  /** True once the dev-mode `Angular hydrated <n> component(s)` log has appeared. */
  get hydrated(): boolean {
    return this.logs.some((text) => HYDRATED_LOG.test(text));
  }

  /**
   * Everything that fails the test: console failures, then unused allowances. With `skipped` (the
   * test skipped itself, so it may never reach what it allowed) unused allowances of every kind
   * (Convex errors, failed requests, console warnings) are not reported; console failures still are.
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
          `expectedFailedRequests entry ${entry.status} ${entry.path} was not used: no request ` +
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

  /** Throws one error listing every problem; called by the fixture at teardown. */
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
    const entry = this.expectedFailedRequests.find(
      (e) => String(e.status) === status && e.path === path,
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
