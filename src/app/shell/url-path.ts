/** The path of a router URL: no query string, no fragment, no trailing slash. */
export function pathOf(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}
