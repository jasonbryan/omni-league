export const LOCAL_BACKEND_ERROR_ANNOTATION = 'local-backend-error';

export const ALLOWED_ROUTES = ['/api/auth/convex/token', '/api/auth/get-session'] as const;
const CONNECTION_ERRORS: ReadonlySet<string> = new Set([
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_EMPTY_RESPONSE',
]);
const FIRST_SERVER_ERROR = 500;
export const FIRST_ERROR_WITH_BODY = 400;
export const ERROR_BODY_BYTES = 200;

export interface BackendAnswer {
  id: string;
  method: string;
  url: string;
  status?: number;
  allowOrigin?: string;
  /** A body below status 400 may hold a token or a session, so only its length is kept. */
  body?: { length: number; preview?: string };
  errorText?: string;
  preflight?: { status?: number; corsError?: string };
}

export type BackendDecision = Pick<
  BackendAnswer,
  'url' | 'status' | 'allowOrigin' | 'errorText' | 'preflight'
>;

function isAllowedRoute(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === new URL(origin).origin &&
      (ALLOWED_ROUTES as readonly string[]).includes(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * True when the record shows `convex-local-backend` answered in place of the app's HTTP action.
 * The app's CORS wrapper answers every preflight 2xx and puts the header on every answer, so a 5xx
 * without the header, a dropped connection, or a 5xx preflight never came from the app. Any other
 * failure, including `net::ERR_FAILED` with no readable preflight, is a real refusal.
 */
export function allowsLocalBackendError(
  answer: BackendDecision,
  { origin, remote }: { origin: string; remote: boolean },
): boolean {
  if (remote || !isAllowedRoute(answer.url, origin)) return false;
  if (answer.status !== undefined) {
    return answer.status >= FIRST_SERVER_ERROR && answer.allowOrigin === undefined;
  }
  if (answer.errorText !== undefined && CONNECTION_ERRORS.has(answer.errorText)) return true;
  const preflightStatus = answer.preflight?.status;
  return preflightStatus !== undefined && preflightStatus >= FIRST_SERVER_ERROR;
}

function describeBody(answer: BackendAnswer): string {
  const { body, status } = answer;
  if (body === undefined) return 'body unavailable';
  if (status !== undefined && status >= FIRST_ERROR_WITH_BODY) return `body ${body.preview ?? ''}`;
  return `body length ${body.length}`;
}

/** Never includes a body of a status below 400, which may hold a token or a session. */
export function describeAnswer(answer: BackendAnswer): string {
  const parts: string[] = [];
  if (answer.status !== undefined) {
    parts.push(
      String(answer.status),
      answer.allowOrigin === undefined
        ? 'no access-control-allow-origin'
        : `access-control-allow-origin ${answer.allowOrigin}`,
      describeBody(answer),
    );
  } else {
    parts.push(answer.errorText ?? 'no answer');
  }
  if (answer.preflight !== undefined) {
    const { status, corsError } = answer.preflight;
    parts.push(`preflight ${status ?? 'status unreadable'}${corsError ? ` ${corsError}` : ''}`);
  }
  return `${answer.method} ${answer.url}: ${parts.join(', ')}`;
}
