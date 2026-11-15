import { type Route } from '@angular/router';
import { appRoutes } from '../../app.routes.app';

function titledPaths(routes: readonly Route[], parent: string): Map<string, string> {
  const paths = new Map<string, string>();
  for (const route of routes) {
    const path = [parent, route.path].filter(Boolean).join('/');
    if (route.title) paths.set(path, String(route.title));
    for (const [childPath, title] of titledPaths(route.children ?? [], path)) {
      paths.set(childPath, title);
    }
  }
  return paths;
}

const APP_TITLES = titledPaths(appRoutes, '');

/** The `title` of the `/app` route at `path`, so that a test route cannot drift from the real one. */
export function appRouteTitle(path: string): string {
  const title = APP_TITLES.get(path);
  if (!title) throw new Error(`no /app route title at "${path}"`);
  return title;
}
