import { publicCampPath } from '../public-camp/public-camp-path';

/** Built from the slugs and the session id, never copied from the current URL, which can carry other parameters or a fragment. */
export function registerCampPath(orgSlug: string, campSlug: string, sessionId?: string): string {
  const base = `/app${publicCampPath(orgSlug, campSlug)}/register`;
  return sessionId === undefined ? base : `${base}?session=${encodeURIComponent(sessionId)}`;
}
