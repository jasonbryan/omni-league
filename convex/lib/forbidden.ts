// Imports only `convex/values`, so the app can tell it from a failed query without the server code.
// Convex shows a client only a `ConvexError`'s data, never a plain error's message.
import { ConvexError } from 'convex/values';

export const FORBIDDEN_CODE = 'FORBIDDEN';

/** Names the kind of team a refused reader asked for, so the page can say who may see it. */
export const TOURNAMENT_TEAM_KIND = 'tournament';

export function forbidden(): ConvexError<{ code: typeof FORBIDDEN_CODE }> {
  return new ConvexError({ code: FORBIDDEN_CODE });
}

export function forbiddenTournamentTeam(): ConvexError<{
  code: typeof FORBIDDEN_CODE;
  team: typeof TOURNAMENT_TEAM_KIND;
}> {
  return new ConvexError({ code: FORBIDDEN_CODE, team: TOURNAMENT_TEAM_KIND });
}

export function isForbiddenTournamentTeam(failure: unknown): boolean {
  if (!isForbidden(failure)) return false;
  const data: unknown = failure instanceof ConvexError ? failure.data : null;
  return (data as { team?: unknown }).team === TOURNAMENT_TEAM_KIND;
}

export function isForbidden(failure: unknown): boolean {
  if (!(failure instanceof ConvexError)) return false;
  const data: unknown = failure.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === FORBIDDEN_CODE
  );
}
