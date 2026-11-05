export type PushOutcome =
  'delivered' | 'gone' | 'tooLarge' | 'rateLimited' | 'serverError' | 'rejected';

export const SERVER_ERROR_BACKOFF_SECONDS = [30, 120, 480] as const;

export const MAX_RETRY_AFTER_SECONDS = 60 * 60;

const DEFAULT_RETRY_AFTER_SECONDS = 60;

// `Date.parse` also reads "-5" and "1.5" as years, so only the day-name form counts as a date.
const HTTP_DATE = /^[A-Za-z]{3}, /;

export const FAILURES_BEFORE_DELETE = 5;

export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'delivered';
  if (status === 404 || status === 410) return 'gone';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'rateLimited';
  if (status >= 500 && status < 600) return 'serverError';
  return 'rejected';
}

export function retryAfterSeconds(header: string | null, nowMs: number): number {
  const text = header?.trim() ?? '';
  let seconds = DEFAULT_RETRY_AFTER_SECONDS;
  if (/^\d+$/.test(text)) {
    seconds = Number(text);
  } else if (HTTP_DATE.test(text) && !Number.isNaN(Date.parse(text))) {
    seconds = Math.ceil((Date.parse(text) - nowMs) / 1000);
  }
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds));
}
