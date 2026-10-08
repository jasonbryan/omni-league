import type { Request, Response } from 'express';
import { serverErrorHandler } from './server-error-handler';

interface FakeResponse {
  headersSent: boolean;
  statusCode?: number;
  contentType?: string;
  body?: string;
}

function fakeResponse(headersSent = false): { res: Response; state: FakeResponse } {
  const state: FakeResponse = { headersSent };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    type(value: string) {
      state.contentType = value;
      return res;
    },
    send(body: string) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
}

const req = { method: 'GET', originalUrl: '/%E0%A4%A' } as Request;

describe('serverErrorHandler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a malformed URI with 400 and a plain body', () => {
    const { res, state } = fakeResponse();
    const next = vi.fn();
    let err: unknown;
    try {
      decodeURIComponent('%E0%A4%A');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(URIError);

    serverErrorHandler(err, req, res, next);

    expect(state.statusCode).toBe(400);
    expect(state.contentType).toBe('text/plain');
    expect(state.body).toBe('Bad Request');
    expect(next).not.toHaveBeenCalled();
  });

  it('answers any other error with 500 and a plain body', () => {
    const { res, state } = fakeResponse();
    const next = vi.fn();

    serverErrorHandler(new Error('boom at /Users/someone/dist/server.mjs'), req, res, next);

    expect(state.statusCode).toBe(500);
    expect(state.contentType).toBe('text/plain');
    expect(state.body).toBe('Internal Server Error');
    expect(next).not.toHaveBeenCalled();
  });

  it('answers a non-Error throw with 500', () => {
    const { res, state } = fakeResponse();

    serverErrorHandler('string thrown', req, res, vi.fn());

    expect(state.statusCode).toBe(500);
    expect(state.body).toBe('Internal Server Error');
  });

  it.each(['development', 'production', undefined])(
    'never puts the message or stack in the body (NODE_ENV=%s)',
    (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      try {
        const { res, state } = fakeResponse();
        const err = new Error('secret /Users/someone/dist/server.mjs');

        serverErrorHandler(err, req, res, vi.fn());

        expect(state.body).toBeTypeOf('string');
        expect(state.body).not.toContain('secret');
        expect(state.body).not.toContain('/Users/');
        expect(state.body).not.toContain('at ');
        expect(state.body).not.toContain(err.stack ?? 'unreachable');
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it('logs the error on the server', () => {
    const { res } = fakeResponse();
    const err = new Error('boom');

    serverErrorHandler(err, req, res, vi.fn());

    expect(console.error).toHaveBeenCalledWith(expect.any(String), err);
  });

  it('delegates to Express when headers are already sent', () => {
    const { res, state } = fakeResponse(true);
    const next = vi.fn();
    const err = new Error('late');

    serverErrorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(state.statusCode).toBeUndefined();
    expect(state.body).toBeUndefined();
  });
});
