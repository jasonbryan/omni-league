const NAMES = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });

export function registeredLine(self: boolean, children: readonly string[]): string | null {
  if (children.length === 0) return self ? "You're registered" : null;
  const names = [...(self ? ['You'] : []), ...children];
  return `${NAMES.format(names)} ${names.length === 1 ? 'is' : 'are'} registered`;
}
