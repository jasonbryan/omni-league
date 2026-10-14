/**
 * Up to two letters for an organization's initials tile (the admin and league sidebars, the staff
 * list): the first letter or digit of the first two words.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
