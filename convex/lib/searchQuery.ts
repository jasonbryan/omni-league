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

/** Most searches offered when a search of several words finds nothing. */
export const SEARCH_SUGGESTION_LIMIT = 3;

/** Lowercased, accents removed, split on anything that is not a letter or a digit. */
export function searchWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Convex text search takes any word, so this keeps what it found only if every word of `q` is a word of the text; the last may be the start of one, as Convex matches it. */
export function matchesEveryWord(searchText: string, q: string): boolean {
  const wanted = searchWords(q);
  if (wanted.length === 0) return false;
  const held = searchWords(searchText);
  const whole = new Set(held);
  const last = wanted[wanted.length - 1];
  return (
    wanted.slice(0, -1).every((word) => whole.has(word)) &&
    held.some((word) => word.startsWith(last))
  );
}

/** Up to three searches, each dropping one space-separated word of `q` as typed, that match at least one of the texts: most texts first, and the later dropped word first on a tie. */
export function suggestFewerWords(searchTexts: readonly string[], q: string): string[] {
  const words = q.split(' ').filter(Boolean);
  if (words.length < 2) return [];
  const candidates = new Set<string>();
  for (let dropped = words.length - 1; dropped >= 0; dropped--) {
    candidates.add(words.filter((_, index) => index !== dropped).join(' '));
  }
  return [...candidates]
    .map((candidate) => ({
      candidate,
      matches: searchTexts.filter((text) => matchesEveryWord(text, candidate)).length,
    }))
    .filter(({ matches }) => matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, SEARCH_SUGGESTION_LIMIT)
    .map(({ candidate }) => candidate);
}
