/** Up to two initials: the first letters of the first and last words of the name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letter = (word: string | undefined) => (word ? (Array.from(word)[0] ?? '') : '');
  return `${letter(first)}${letter(last)}`.toUpperCase();
}
