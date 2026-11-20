import { ERROR_BODY_BYTES, FIRST_ERROR_WITH_BODY, type BackendAnswer } from './local-backend-error';

export interface CdpSession {
  send(method: string, params?: object): Promise<unknown>;
  on(event: string, handler: (payload: never) => void): unknown;
}

interface RequestWillBeSent {
  requestId: string;
  request: { url: string; method: string };
  initiator: { type: string; requestId?: string };
}

interface ResponseReceivedExtraInfo {
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
}

interface LoadingFailed {
  requestId: string;
  errorText: string;
  corsErrorStatus?: { corsError: string };
}

interface RequestPaused {
  requestId: string;
  networkId?: string;
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
}

interface Entry {
  id: string;
  method: string;
  url: string;
  preflightOf?: string;
  status?: number;
  allowOrigin?: string;
  body?: BackendAnswer['body'];
  errorText?: string;
  corsError?: string;
}

const CORS_HEADER = 'access-control-allow-origin';
let recorders = 0;

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/**
 * Records, over the Chrome DevTools Protocol, what the local backend answered to the requests of
 * one page. Playwright's own `response` event never fires for an answer the page's CORS check
 * blocks, and its `requestfailed` event hides the preflight, which it does not report in Chromium.
 *
 * The body comes from a `Fetch` pause on the auth routes, because the `Network` domain has no body
 * for a blocked answer. Every pause is continued unchanged, and the pause reads the body only when
 * the answer lacks the CORS header, which the app's answers never do.
 */
export class BackendRecorder {
  readonly ready: Promise<void>;
  private readonly number = ++recorders;
  private readonly origin: string;
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly session: CdpSession,
    origin: string,
  ) {
    this.origin = new URL(origin).origin;
    this.on<RequestWillBeSent>('Network.requestWillBeSent', (event) => this.onRequest(event));
    this.on<ResponseReceivedExtraInfo>('Network.responseReceivedExtraInfo', (event) =>
      this.onResponse(event),
    );
    this.on<LoadingFailed>('Network.loadingFailed', (event) => this.onFailure(event));
    this.on<RequestPaused>('Fetch.requestPaused', (event) => this.onPause(event));
    this.ready = this.enable();
  }

  private on<T>(event: string, handler: (payload: T) => void): void {
    this.session.on(event, handler);
  }

  private async enable(): Promise<void> {
    const patterns = [{ urlPattern: `${this.origin}/api/auth/*`, requestStage: 'Response' }];
    await Promise.all([
      this.session.send('Network.enable').catch(() => undefined),
      this.session.send('Fetch.enable', { patterns }).catch(() => undefined),
    ]);
  }

  /** Waits for every body read and for the events the browser sent before this call. */
  async settle(): Promise<void> {
    await this.ready;
    await Promise.all(this.pending);
    // A reply follows the events sent before it on the same session.
    await this.session.send('Runtime.evaluate', { expression: '0' }).catch(() => undefined);
    await Promise.all(this.pending);
  }

  /** The requests to `url` that failed, each with the answer or the failure and its preflight. */
  failedAnswers(url: string): BackendAnswer[] {
    const preflights = [...this.entries.values()].filter((entry) => entry.preflightOf).reverse();
    return [...this.entries.values()]
      .filter((entry) => entry.errorText !== undefined && !entry.preflightOf && entry.url === url)
      .map((entry) => {
        const preflight = preflights.find((candidate) => candidate.preflightOf === entry.id);
        return {
          id: `${this.number}:${entry.id}`,
          method: entry.method,
          url: entry.url,
          status: entry.status,
          allowOrigin: entry.allowOrigin,
          body: entry.body,
          errorText: entry.errorText,
          preflight: preflight && { status: preflight.status, corsError: entry.corsError },
        };
      });
  }

  private onRequest({ requestId, request, initiator }: RequestWillBeSent): void {
    if (!request.url.startsWith(`${this.origin}/`)) return;
    const existing = this.entries.get(requestId);
    if (existing) {
      existing.url = request.url;
      return;
    }
    this.entries.set(requestId, {
      id: requestId,
      method: request.method,
      url: request.url,
      preflightOf: initiator.type === 'preflight' ? initiator.requestId : undefined,
    });
  }

  private onResponse({ requestId, statusCode, headers }: ResponseReceivedExtraInfo): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    entry.status = statusCode;
    entry.allowOrigin = headerValue(headers, CORS_HEADER);
  }

  private onFailure({ requestId, errorText, corsErrorStatus }: LoadingFailed): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    entry.errorText = errorText;
    entry.corsError = corsErrorStatus?.corsError;
  }

  private onPause(event: RequestPaused): void {
    const pause = this.readBody(event).then(
      () => this.session.send('Fetch.continueResponse', { requestId: event.requestId }),
      () => this.session.send('Fetch.continueResponse', { requestId: event.requestId }),
    );
    const tracked = pause.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(tracked);
    void tracked.then(() => this.pending.delete(tracked));
  }

  private async readBody({
    requestId,
    networkId,
    responseStatusCode,
    responseHeaders = [],
  }: RequestPaused): Promise<void> {
    const entry = networkId === undefined ? undefined : this.entries.get(networkId);
    if (!entry || responseStatusCode === undefined) return;
    if (responseHeaders.some(({ name }) => name.toLowerCase() === CORS_HEADER)) return;
    const reply = (await this.session.send('Fetch.getResponseBody', { requestId })) as {
      body: string;
      base64Encoded: boolean;
    };
    const bytes = Buffer.from(reply.body, reply.base64Encoded ? 'base64' : 'utf8');
    // A token or a session in a successful answer stays out of every line; only its length is kept.
    const preview =
      responseStatusCode >= FIRST_ERROR_WITH_BODY
        ? bytes.subarray(0, ERROR_BODY_BYTES).toString('utf8').replace(/\s+/g, ' ')
        : undefined;
    entry.body = { length: bytes.length, preview };
  }
}
