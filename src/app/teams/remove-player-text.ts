import { ConvexError } from 'convex/values';
import type { AlertText, OfflineAlertText } from '../organizations/admin/alert-text';

export type RemoveFailure =
  { kind: 'offline' } | { kind: 'captainRequired' } | { kind: 'notRostered' } | { kind: 'failed' };

export type RemoveAlertView =
  ({ kind: 'offline' } & OfflineAlertText) | ({ kind: 'failed' } & AlertText);

/** Only a refusal's code is read: any other failure's message is server detail the page never shows. */
export function removeFailureOf(error: unknown): RemoveFailure {
  if (!(error instanceof ConvexError)) return { kind: 'failed' };
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return { kind: 'failed' };
  const { code } = data as { code?: unknown };
  if (code === 'captainRequired') return { kind: 'captainRequired' };
  if (code === 'notRostered') return { kind: 'notRostered' };
  return { kind: 'failed' };
}

export function removeFailureText(failure: RemoveFailure, name: string): RemoveAlertView {
  const title = `${name} could not be removed.`;
  switch (failure.kind) {
    case 'offline':
      return {
        kind: 'offline',
        description: `${name} is still on the team. Try again when you’re connected.`,
      };
    case 'captainRequired':
      return { kind: 'failed', title, description: 'A team needs its captain.' };
    case 'notRostered':
      return { kind: 'failed', title, description: 'They’re no longer on the team.' };
    case 'failed':
      return { kind: 'failed', title, description: 'Check your connection and try again.' };
  }
}

export function removedText(name: string, teamName: string): AlertText {
  return {
    title: `${name} was removed from ${teamName}.`,
    description: 'They can no longer open this page. You can invite them again.',
  };
}
