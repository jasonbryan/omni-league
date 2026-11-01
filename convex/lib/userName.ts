// Imports nothing, so the app can import it.

export const MAX_USER_NAME_LENGTH = 100;

export type UserNameProblem = 'empty' | 'tooLong';

export function checkUserName(
  name: string,
): { ok: true; name: string } | { ok: false; code: UserNameProblem } {
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, code: 'empty' };
  if (trimmed.length > MAX_USER_NAME_LENGTH) return { ok: false, code: 'tooLong' };
  return { ok: true, name: trimmed };
}
