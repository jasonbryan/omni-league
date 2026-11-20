import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BackendRecorder, type CdpSession } from '../support/backend-recorder';
import { ConsoleGuard } from '../support/console-guard';
import { LOCAL_BUILD_ONLY, LOCAL_CONVEX_SITE_URL, remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';
import { allowsLocalBackendError, describeAnswer } from '../support/local-backend-error';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

// The expected-failure probes would otherwise write a failure screenshot into the report.
test.use({ screenshot: 'off' });

const TOKEN_PATH = '/api/auth/convex/token';
const SESSION_PATH = '/api/auth/get-session';
const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.SECRET-PAYLOAD.SIGNATURE';
const BACKEND_ONLY_NOTE =
  'the answer is read over the Chrome DevTools Protocol, which Chromium has';

type PreflightReply = 'allow' | 'no-header' | number;
type AnswerReply = { status: number; body: string } | 'empty-response';

interface Stub {
  origin: string;
  close: () => Promise<void>;
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Stub> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A page document served by a real server, because `page.route` would answer the preflights itself. */
function documentServer(): Promise<Stub> {
  return listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<p>probe</p>');
  });
}

/** Answers like the local backend does when its own error replaces the app's HTTP action. */
function backendStub(options: {
  preflight: PreflightReply;
  answer: AnswerReply;
  answerAllowsOrigin?: boolean;
}): Promise<Stub> {
  return listen((request, response) => {
    const origin = request.headers.origin ?? '';
    const allow = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'better-auth-cookie',
    };
    if (request.method === 'OPTIONS') {
      if (options.preflight === 'allow') response.writeHead(204, allow);
      else if (options.preflight === 'no-header') response.writeHead(204);
      else response.writeHead(options.preflight, { 'content-type': 'application/json' });
      response.end(typeof options.preflight === 'number' ? '{"message":"preflight"}' : '');
      return;
    }
    if (options.answer === 'empty-response') {
      request.socket.destroy();
      return;
    }
    response.writeHead(options.answer.status, {
      'content-type': 'application/json',
      ...(options.answerAllowsOrigin ? allow : {}),
    });
    response.end(options.answer.body);
  });
}

async function guardedPage(
  browser: Browser,
  documentOrigin: string,
  localBackendOrigin?: string,
  { blindToResponses = false } = {},
): Promise<{ page: Page; guard: ConsoleGuard; close: () => Promise<void> }> {
  const context = await browser.newContext();
  if (blindToResponses) hideResponseEvents(context);
  const page = await context.newPage();
  const guard = new ConsoleGuard({ localBackendOrigin });
  guard.attach(page);
  await guard.settle();
  await page.goto(documentOrigin);
  return { page, guard, close: () => context.close() };
}

/** The guard then never learns a status, as when the browser does not report an answer. */
function hideResponseEvents(context: BrowserContext): void {
  const open = context.newCDPSession.bind(context);
  context.newCDPSession = async (target) => {
    const session = await open(target);
    const listen = session.on.bind(session) as (event: string, handler: () => void) => unknown;
    session.on = ((event: string, handler: () => void) =>
      event === 'Network.responseReceivedExtraInfo' ? session : listen(event, handler)) as never;
    return session;
  };
}

/** A credentialed fetch with a custom header, which makes the browser send a preflight first. */
async function fetchAuth(page: Page, url: string): Promise<void> {
  await Promise.all([
    page.waitForEvent(
      'console',
      (m) => m.type() === 'error' && m.text().startsWith('Failed to load resource'),
    ),
    page.evaluate(
      (u) =>
        fetch(u, { credentials: 'include', headers: { 'Better-Auth-Cookie': 'probe' } }).then(
          () => undefined,
          () => undefined,
        ),
      url,
    ),
  ]);
}

const TOKEN_ANSWER_503: AnswerReply = {
  status: 503,
  body: '{"code":"UNAVAILABLE","message":"service unavailable"}',
};

test.describe(
  'console guard and the local backend answering in place of the app',
  VIEWPORT_AGNOSTIC,
  () => {
    test.describe('a blocked answer the guard reads over CDP', () => {
      test.skip(!!remoteBaseUrl, 'the allowance applies to local runs only');

      test.beforeEach(({ browserName }) => {
        test.skip(browserName !== 'chromium', BACKEND_ONLY_NOTE);
      });

      for (const [path, status] of [
        [TOKEN_PATH, 503],
        [TOKEN_PATH, 500],
        [SESSION_PATH, 503],
        [SESSION_PATH, 500],
      ] as const) {
        test(`passes for a ${status} with no CORS header on ${path}, and records it`, async ({
          browser,
        }) => {
          const doc = await documentServer();
          const stub = await backendStub({
            preflight: 'allow',
            answer: { status, body: '{"message":"busy"}' },
          });
          const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
          await fetchAuth(page, `${stub.origin}${path}`);
          await guard.settle();
          expect(guard.problems()).toEqual([]);
          expect(guard.localBackendErrors).toEqual([
            expect.stringContaining(
              `GET ${stub.origin}${path}: ${status}, no access-control-allow-origin, body `,
            ),
          ]);
          await close();
          await stub.close();
          await doc.close();
        });
      }

      test('records the first 200 bytes of an error body', async ({ browser }) => {
        const doc = await documentServer();
        const body = JSON.stringify({ message: 'x'.repeat(300) });
        const stub = await backendStub({ preflight: 'allow', answer: { status: 503, body } });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.localBackendErrors).toEqual([
          expect.stringContaining(`body ${body.slice(0, 200)}`),
        ]);
        expect(guard.localBackendErrors[0]).not.toContain(body.slice(0, 201));
        await close();
        await stub.close();
        await doc.close();
      });

      test('annotates one record per blocked request', async ({ browser }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 'allow', answer: TOKEN_ANSWER_503 });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await fetchAuth(page, `${stub.origin}${SESSION_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([]);
        expect(guard.localBackendErrors).toHaveLength(2);
        await close();
        await stub.close();
        await doc.close();
      });

      test('passes for an empty response from the backend', async ({ browser }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 'allow', answer: 'empty-response' });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([]);
        expect(guard.localBackendErrors).toEqual([
          expect.stringContaining('net::ERR_EMPTY_RESPONSE'),
        ]);
        await close();
        await stub.close();
        await doc.close();
      });

      for (const [abort, errorText] of [
        ['connectionreset', 'net::ERR_CONNECTION_RESET'],
        ['connectionrefused', 'net::ERR_CONNECTION_REFUSED'],
      ] as const) {
        test(`passes when the token request fails with ${errorText}`, async ({ browser }) => {
          const doc = await documentServer();
          const { page, guard, close } = await guardedPage(browser, doc.origin);
          await page.route(`${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`, (route) => route.abort(abort));
          await fetchAuth(page, `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`);
          await guard.settle();
          expect(guard.problems()).toEqual([]);
          expect(guard.localBackendErrors).toEqual([expect.stringContaining(errorText)]);
          await close();
          await doc.close();
        });
      }

      test('fails when the token request fails with net::ERR_FAILED', async ({ browser }) => {
        const doc = await documentServer();
        const { page, guard, close } = await guardedPage(browser, doc.origin);
        await page.route(`${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`, (route) => route.abort('failed'));
        await fetchAuth(page, `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringMatching(
            /^console\.error: Failed to load resource: net::ERR_FAILED .*net::ERR_FAILED/,
          ),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await doc.close();
      });

      test('fails on a 401 with no CORS header, with the status and the body in the failure line', async ({
        browser,
      }) => {
        const doc = await documentServer();
        const stub = await backendStub({
          preflight: 'allow',
          answer: { status: 401, body: '{"message":"Unauthorized"}' },
        });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringContaining(
            `GET ${stub.origin}${TOKEN_PATH}: 401, no access-control-allow-origin, body {"message":"Unauthorized"}`,
          ),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails on a 200 with no CORS header, with the body length and none of its bytes', async ({
        browser,
      }) => {
        const doc = await documentServer();
        const body = JSON.stringify({ token: SECRET_TOKEN });
        const stub = await backendStub({ preflight: 'allow', answer: { status: 200, body } });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        const problems = guard.problems();
        expect(problems).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringContaining(
            `GET ${stub.origin}${TOKEN_PATH}: 200, no access-control-allow-origin, body length ${body.length}`,
          ),
        ]);
        expect(JSON.stringify(problems)).not.toContain('SECRET-PAYLOAD');
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails on a 503 that carries the CORS header, which the app produced', async ({
        browser,
      }) => {
        const doc = await documentServer();
        const stub = await backendStub({
          preflight: 'allow',
          answer: TOKEN_ANSWER_503,
          answerAllowsOrigin: true,
        });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('the server responded with a status of 503'),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails on a 503 with no CORS header on another auth route', async ({ browser }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 'allow', answer: TOKEN_ANSWER_503 });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}/api/auth/sign-in/email`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringContaining(
            `GET ${stub.origin}/api/auth/sign-in/email: 503, no access-control-allow-origin`,
          ),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails on a 503 with no CORS header from another origin', async ({ browser }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 'allow', answer: TOKEN_ANSWER_503 });
        const { page, guard, close } = await guardedPage(browser, doc.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringMatching(/^console\.error: Failed to load resource: net::ERR_FAILED /),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('passes when the backend answers the preflight 503, and records the preflight', async ({
        browser,
      }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 503, answer: TOKEN_ANSWER_503 });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([]);
        expect(guard.localBackendErrors).toEqual([
          expect.stringMatching(/preflight 503 PreflightMissingAllowOriginHeader$/),
        ]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails when the preflight is answered 204 without the CORS header', async ({
        browser,
      }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 'no-header', answer: TOKEN_ANSWER_503 });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin);
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringMatching(/preflight 204 PreflightMissingAllowOriginHeader\]$/),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails when the status of the preflight cannot be read', async ({ browser }) => {
        const doc = await documentServer();
        const stub = await backendStub({ preflight: 503, answer: TOKEN_ANSWER_503 });
        const { page, guard, close } = await guardedPage(browser, doc.origin, stub.origin, {
          blindToResponses: true,
        });
        await fetchAuth(page, `${stub.origin}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringMatching(/preflight status unreadable PreflightMissingAllowOriginHeader\]$/),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await stub.close();
        await doc.close();
      });

      test('fails when the real backend refuses the preflight of an untrusted origin', async ({
        browser,
      }) => {
        test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
        const doc = await documentServer();
        const { page, guard, close } = await guardedPage(browser, doc.origin);
        await fetchAuth(page, `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`);
        await guard.settle();
        expect(guard.problems()).toEqual([
          expect.stringContaining('blocked by CORS policy'),
          expect.stringMatching(
            new RegExp(
              `GET ${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}: net::ERR_FAILED, preflight \\d{3} Preflight\\w+\\]$`,
            ),
          ),
        ]);
        expect(guard.localBackendErrors).toEqual([]);
        await close();
        await doc.close();
      });
    });

    test.describe('the recorder, fed CDP events', () => {
      const ORIGIN = 'http://127.0.0.1:3211';
      const URL_TOKEN = `${ORIGIN}${TOKEN_PATH}`;

      class FakeSession implements CdpSession {
        readonly handlers = new Map<string, (payload: unknown) => void>();
        bodies = new Map<string, string | Error>();
        on(event: string, handler: (payload: never) => void): this {
          this.handlers.set(event, handler as (payload: unknown) => void);
          return this;
        }
        emit(event: string, payload: unknown): void {
          this.handlers.get(event)?.(payload);
        }
        send(method: string, params?: { requestId?: string }): Promise<unknown> {
          if (method === 'Fetch.getResponseBody') {
            const body = this.bodies.get(params?.requestId ?? '');
            if (body === undefined || body instanceof Error) {
              return Promise.reject(body ?? new Error('no body'));
            }
            return Promise.resolve({
              body: Buffer.from(body).toString('base64'),
              base64Encoded: true,
            });
          }
          return Promise.resolve({});
        }
      }

      function answered(
        session: FakeSession,
        id: string,
        status: number,
        headers: Record<string, string>,
      ): void {
        session.emit('Network.requestWillBeSent', {
          requestId: id,
          request: { url: URL_TOKEN, method: 'GET' },
          initiator: { type: 'script' },
        });
        session.emit('Network.responseReceivedExtraInfo', {
          requestId: id,
          statusCode: status,
          headers,
        });
        session.emit('Fetch.requestPaused', {
          requestId: `fetch-${id}`,
          networkId: id,
          responseStatusCode: status,
          responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
        });
        session.emit('Network.loadingFailed', {
          requestId: id,
          errorText: 'net::ERR_FAILED',
          corsErrorStatus: { corsError: 'MissingAllowOriginHeader' },
        });
      }

      test('records body unavailable when the body cannot be read, and does not throw', async () => {
        const session = new FakeSession();
        const recorder = new BackendRecorder(session, ORIGIN);
        answered(session, '1.1', 503, {});
        await recorder.settle();
        const [answer] = recorder.failedAnswers(URL_TOKEN);
        expect(describeAnswer(answer)).toBe(
          `GET ${URL_TOKEN}: 503, no access-control-allow-origin, body unavailable`,
        );
      });

      test('keeps only the length of a 2xx body', async () => {
        const session = new FakeSession();
        session.bodies.set('fetch-1.1', JSON.stringify({ token: SECRET_TOKEN }));
        const recorder = new BackendRecorder(session, ORIGIN);
        answered(session, '1.1', 200, {});
        await recorder.settle();
        const [answer] = recorder.failedAnswers(URL_TOKEN);
        expect(describeAnswer(answer)).toBe(
          `GET ${URL_TOKEN}: 200, no access-control-allow-origin, body length ${JSON.stringify({ token: SECRET_TOKEN }).length}`,
        );
        expect(JSON.stringify(answer)).not.toContain('SECRET-PAYLOAD');
      });

      test('links a preflight to its request by the initiator, not by the URL', async () => {
        const session = new FakeSession();
        const recorder = new BackendRecorder(session, ORIGIN);
        for (const [id, preflight, status] of [
          ['1.1', 'p1', 503],
          ['2.1', 'p2', 204],
        ] as const) {
          session.emit('Network.requestWillBeSent', {
            requestId: id,
            request: { url: URL_TOKEN, method: 'GET' },
            initiator: { type: 'script' },
          });
          session.emit('Network.requestWillBeSent', {
            requestId: preflight,
            request: { url: URL_TOKEN, method: 'OPTIONS' },
            initiator: { type: 'preflight', requestId: id },
          });
          session.emit('Network.responseReceivedExtraInfo', {
            requestId: preflight,
            statusCode: status,
            headers: {},
          });
        }
        // The second request finishes first.
        for (const id of ['2.1', '1.1']) {
          session.emit('Network.loadingFailed', {
            requestId: id,
            errorText: 'net::ERR_FAILED',
            corsErrorStatus: { corsError: 'PreflightMissingAllowOriginHeader' },
          });
        }
        await recorder.settle();
        expect(recorder.failedAnswers(URL_TOKEN).map((a) => a.preflight?.status)).toEqual([
          503, 204,
        ]);
      });

      test('ignores requests to another origin', async () => {
        const session = new FakeSession();
        const recorder = new BackendRecorder(session, ORIGIN);
        session.emit('Network.requestWillBeSent', {
          requestId: '1.1',
          request: { url: 'http://127.0.0.1:9/x', method: 'GET' },
          initiator: { type: 'script' },
        });
        session.emit('Network.loadingFailed', { requestId: '1.1', errorText: 'net::ERR_FAILED' });
        await recorder.settle();
        expect(recorder.failedAnswers('http://127.0.0.1:9/x')).toEqual([]);
      });
    });

    test.describe('the matcher', () => {
      const local = { origin: LOCAL_CONVEX_SITE_URL, remote: false };
      const token = `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`;
      const session = `${LOCAL_CONVEX_SITE_URL}${SESSION_PATH}`;

      for (const corsError of ['PreflightMissingAllowOriginHeader', 'PreflightInvalidStatus']) {
        test(`allows a Chromium preflight of status 503 with ${corsError}`, () => {
          expect(
            allowsLocalBackendError(
              { url: token, errorText: 'net::ERR_FAILED', preflight: { status: 503, corsError } },
              local,
            ),
          ).toBe(true);
        });

        test(`refuses a Chromium preflight of status 204 with ${corsError}`, () => {
          expect(
            allowsLocalBackendError(
              { url: token, errorText: 'net::ERR_FAILED', preflight: { status: 204, corsError } },
              local,
            ),
          ).toBe(false);
        });
      }

      test('refuses a preflight whose status could not be read', () => {
        expect(
          allowsLocalBackendError(
            {
              url: token,
              errorText: 'net::ERR_FAILED',
              preflight: { corsError: 'PreflightMissingAllowOriginHeader' },
            },
            local,
          ),
        ).toBe(false);
        expect(allowsLocalBackendError({ url: token, errorText: 'net::ERR_FAILED' }, local)).toBe(
          false,
        );
      });

      for (const errorText of [
        'net::ERR_CONNECTION_RESET',
        'net::ERR_CONNECTION_REFUSED',
        'net::ERR_EMPTY_RESPONSE',
      ]) {
        test(`allows ${errorText} with no response`, () => {
          expect(allowsLocalBackendError({ url: session, errorText }, local)).toBe(true);
        });
      }

      test('refuses other failures with no response', () => {
        for (const errorText of ['net::ERR_FAILED', 'net::ERR_ABORTED', 'net::ERR_TIMED_OUT']) {
          expect(allowsLocalBackendError({ url: token, errorText }, local)).toBe(false);
        }
      });

      test('allows only a 5xx without the CORS header', () => {
        for (const status of [500, 502, 503, 599]) {
          expect(allowsLocalBackendError({ url: token, status }, local)).toBe(true);
        }
        for (const status of [200, 204, 302, 400, 401, 403, 404, 429]) {
          expect(allowsLocalBackendError({ url: token, status }, local)).toBe(false);
        }
        expect(
          allowsLocalBackendError(
            { url: token, status: 503, allowOrigin: 'http://localhost:4000' },
            local,
          ),
        ).toBe(false);
      });

      test('refuses another route and another origin', () => {
        const answer = { status: 503 };
        expect(
          allowsLocalBackendError(
            { url: `${LOCAL_CONVEX_SITE_URL}/api/auth/sign-in/email`, ...answer },
            local,
          ),
        ).toBe(false);
        expect(allowsLocalBackendError({ url: `${token}/extra`, ...answer }, local)).toBe(false);
        expect(
          allowsLocalBackendError(
            { url: 'http://127.0.0.1:9999/api/auth/convex/token', ...answer },
            local,
          ),
        ).toBe(false);
        expect(
          allowsLocalBackendError(
            { url: `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}?x=1`, ...answer },
            local,
          ),
        ).toBe(true);
      });

      test('allows nothing on a run against E2E_BASE_URL', () => {
        const remote = { origin: LOCAL_CONVEX_SITE_URL, remote: true };
        expect(allowsLocalBackendError({ url: token, status: 503 }, remote)).toBe(false);
        expect(
          allowsLocalBackendError({ url: token, errorText: 'net::ERR_CONNECTION_RESET' }, remote),
        ).toBe(false);
        expect(
          allowsLocalBackendError(
            { url: token, errorText: 'net::ERR_FAILED', preflight: { status: 503 } },
            remote,
          ),
        ).toBe(false);
      });
    });
  },
);

test.describe(
  'console fixture wiring for the local backend (real fixture)',
  VIEWPORT_AGNOSTIC,
  () => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);

    test.beforeEach(({ browserName }) => {
      test.skip(browserName !== 'chromium', BACKEND_ONLY_NOTE);
    });

    test('a reset connection on the token request passes', async ({ page }) => {
      const doc = await documentServer();
      await page.goto(doc.origin);
      await page.route(`${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`, (route) =>
        route.abort('connectionreset'),
      );
      await fetchAuth(page, `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`);
      await doc.close();
    });

    test('a token request that fails with net::ERR_FAILED fails the test', async ({ page }) => {
      test.fail(true, 'net::ERR_FAILED with a 204 preflight is not a backend error');
      const doc = await documentServer();
      await page.goto(doc.origin);
      await page.route(`${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`, (route) => route.abort('failed'));
      await fetchAuth(page, `${LOCAL_CONVEX_SITE_URL}${TOKEN_PATH}`);
      await doc.close();
    });
  },
);
