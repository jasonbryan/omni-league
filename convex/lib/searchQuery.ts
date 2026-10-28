/** Convex text search takes at most 16 terms per query. */
export const SEARCH_QUERY_MAX_WORDS = 16;

export const SEARCH_QUERY_MAX_LENGTH = 100;

export function joinSearchText(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join(' ');
}

/** Uses the first `q` only, so a repeated parameter cannot change the query; the server and the browser share it. */
export function parseSearchQuery(values: readonly string[]): string {
  const [first = ''] = values;
  const words = first.split(/\s+/).filter(Boolean).slice(0, SEARCH_QUERY_MAX_WORDS);
  return Array.from(words.join(' ')).slice(0, SEARCH_QUERY_MAX_LENGTH).join('').trimEnd();
}

export const SEARCH_SUGGESTION_LIMIT = 3;

export function searchWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function holdsEveryWord(held: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.length === 0) return false;
  const whole = new Set(held);
  const last = wanted[wanted.length - 1];
  return (
    wanted.slice(0, -1).every((word) => whole.has(word)) &&
    held.some((word) => word.startsWith(last))
  );
}

/** Convex text search takes any word, so this keeps what it found only if every word of `q` is a word of the text; the last may be the start of one, as Convex matches it. */
export function matchesEveryWord(searchText: string, q: string): boolean {
  return holdsEveryWord(searchWords(searchText), searchWords(q));
}

export function suggestFewerWords(searchTexts: readonly string[], q: string): string[] {
  const words = q.split(' ').filter(Boolean);
  if (words.length < 2) return [];
  const heldWords = searchTexts.map(searchWords);
  const candidates = new Map<string, number>();
  for (let dropped = words.length - 1; dropped >= 0; dropped--) {
    const candidate = words.filter((_, index) => index !== dropped).join(' ');
    if (!candidates.has(candidate)) candidates.set(candidate, dropped);
  }
  return [...candidates]
    .map(([candidate, dropped]) => {
      const wanted = searchWords(candidate);
      return {
        candidate,
        dropped,
        matches: heldWords.filter((held) => holdsEveryWord(held, wanted)).length,
      };
    })
    .filter(({ matches }) => matches > 0)
    .sort((a, b) => b.matches - a.matches || b.dropped - a.dropped)
    .slice(0, SEARCH_SUGGESTION_LIMIT)
    .map(({ candidate }) => candidate);
}
