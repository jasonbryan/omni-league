import {
  badRequestResponse,
  internalServerErrorResponse,
  isMalformedPath,
  notFoundResponse,
} from './server-error-response';

// Plain-text responses and the path-only 400 rule of the SSR entry (#37, from #24 / PR #38).
describe('server error responses', () => {
  it.each(['/%E0%A4%A', '/o/%', '/o/%E0%A4%A', '/%'])('treats %s as a malformed path', (path) => {
    expect(isMalformedPath(path)).toBe(true);
  });

  it.each(['/', '/o/acme', '/o/%E2%82%AC', '/o/%41'])('treats %s as a well-formed path', (path) => {
    expect(isMalformedPath(path)).toBe(false);
  });

  it.each([
    [badRequestResponse, 400, 'Bad Request'],
    [internalServerErrorResponse, 500, 'Internal Server Error'],
    [notFoundResponse, 404, 'Not found'],
  ] as const)('builds a plain-text response (%#)', async (build, status, body) => {
    const response = build();

    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(body);
  });

  it('builds a fresh response each time, so a body is never read twice', () => {
    expect(badRequestResponse()).not.toBe(badRequestResponse());
  });
});
