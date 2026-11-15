import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  PRIMARY_OUTLET,
  TitleStrategy,
  type Params,
  type Route,
  type RouterStateSnapshot,
} from '@angular/router';

const SITE_NAME = 'Omni League';
const SEPARATOR = ' | ';

/** The one writer of the tab title for every view an `/app` page can show; the app shell's slim bar reads `barText`. */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  private readonly title = inject(Title);
  private readonly bar = signal(SITE_NAME);

  readonly barText = this.bar.asReadonly();

  private readonly routeTitlesApplied = signal(0);
  /** Changes when a route title replaces the title, so a view that stays on screen through the navigation can set its own again. */
  readonly routeTitles = this.routeTitlesApplied.asReadonly();

  set(parts: readonly string[], options: { readonly bar?: string } = {}): void {
    this.title.setTitle([...parts, SITE_NAME].join(SEPARATOR));
    this.bar.set(options.bar ?? parts[0] ?? SITE_NAME);
  }

  setFromRoute(parts: readonly string[]): void {
    this.set(parts);
    this.routeTitlesApplied.update((count) => count + 1);
  }
}

/** Sets the title of a view that replaces a page's content, and again after a route title applies while the view stays on screen. */
export function bindViewTitle(part: string): void {
  const pageTitle = inject(PageTitle);
  effect(() => {
    pageTitle.routeTitles();
    pageTitle.set([part]);
  });
}

interface RouteIdentity {
  readonly config: Route | null;
  readonly params: Params;
}

function identityOf(snapshot: RouterStateSnapshot): RouteIdentity {
  let route = snapshot.root;
  let child = route.children.find((c) => c.outlet === PRIMARY_OUTLET);
  while (child) {
    route = child;
    child = route.children.find((c) => c.outlet === PRIMARY_OUTLET);
  }
  return { config: route.routeConfig, params: route.params };
}

function sameParams(a: Params, b: Params): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** A route without a `title` changes nothing, so the public pages' own titles stay. */
@Injectable()
export class PageTitleStrategy extends TitleStrategy {
  private readonly pageTitle = inject(PageTitle);
  private last: RouteIdentity | undefined;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const current = identityOf(snapshot);
    const last = this.last;
    this.last = current;
    // A jump to a fragment or a new query string keeps the page's data title, since the page does not set it again.
    if (last?.config === current.config && sameParams(last.params, current.params)) return;
    const title = this.buildTitle(snapshot);
    if (title === undefined) return;
    const parts = title.split(SEPARATOR);
    if (parts.at(-1) === SITE_NAME) parts.pop();
    this.pageTitle.setFromRoute(parts);
  }
}
