import type { ConsoleMessage, Page } from '@playwright/test';

/** Document status a test may expect; only 404 is supported (#23). */
export type ExpectedDocumentStatus = 404;

export interface ConsoleGuardOptions {
  /** Ignore the page's own "Failed to load resource … 404" message (and nothing else). */
  expectedDocumentStatus?: ExpectedDocumentStatus;
  /** Convex function names (`module:function`) whose rejected mutation or action may log. */
  expectedConvexErrors?: readonly string[];
}

const NG05_WARNING = /\bNG05\d\d\b/;
const DOCUMENT_404_PREFIX = 'Failed to load resource: the server responded with a status of 404';
const HYDRATED_LOG = /Angular hydrated \d+ component\(s\)/;

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Console rules of ADR 0005 for one test. A test fails on:
 * - any uncaught page error (`pageerror`);
 * - any `console` message of type `error` (NG0500 to NG0504 included);
 * - any `console` message of type `warning` matching `/\bNG05\d\d\b/` (NG0505, NG0506, NG0508).
 * `log` and `info` are ignored (they are kept only for the hydration assertion).
 *
 * Two opt-in, per-test allowances (see the fixture options in `fixtures.ts`):
 * - `expectedDocumentStatus: 404` ignores exactly the main document's own 404 resource message;
 * - `expectedConvexErrors` ignores `[CONVEX M(<name>)] ` / `[CONVEX A(<name>)] ` for listed names,
 *   and fails the test if a listed name never produced such a message.
 */
export class ConsoleGuard {
  private readonly failures: string[] = [];
  private readonly logs: string[] = [];
  private readonly usedConvexAllowances = new Set<string>();
  private readonly expectedConvexErrors: readonly string[];
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

  /** Everything that fails the test: console failures, then unused Convex allowances. */
  problems(): string[] {
    const unused = this.expectedConvexErrors
      .filter((name) => !this.usedConvexAllowances.has(name))
      .map(
        (name) =>
          `expectedConvexErrors entry "${name}" was not used: no [CONVEX M(${name})] or ` +
          `[CONVEX A(${name})] console error was logged; remove the stale entry`,
      );
    return [...this.failures, ...unused];
  }

  /** Throws one error listing every problem; called by the fixture at teardown. */
  verify(): void {
    const problems = this.problems();
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
    if (type === 'warning' && NG05_WARNING.test(text)) {
      this.failures.push(`console.warn: ${text}`);
      return;
    }
    if (type !== 'error') return;
    if (this.isExpectedDocument404(page, message, text)) return;
    if (this.matchConvexAllowance(text)) return;
    const url = message.location().url;
    this.failures.push(`console.error: ${text}${url ? ` (at ${url})` : ''}`);
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
