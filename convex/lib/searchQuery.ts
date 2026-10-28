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
