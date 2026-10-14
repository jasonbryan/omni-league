/** Built from the slug, never copied from the current URL, which can carry a query string or a fragment. */
export function adminPath(slug: string, section = ''): string {
  const base = `/app/organizations/${encodeURIComponent(slug)}`;
  return section ? `${base}/${section}` : base;
}
