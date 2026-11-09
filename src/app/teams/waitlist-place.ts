import { ConvexError } from 'convex/values';

export interface WaitlistPlace {
  teamName: string;
  position: number;
}

export function waitlistPlaceOf(failure: unknown): WaitlistPlace | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { teamName, position } = data as { teamName?: unknown; position?: unknown };
  return typeof teamName === 'string' && typeof position === 'number'
    ? { teamName, position }
    : null;
}
