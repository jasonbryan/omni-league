import { Injectable, inject, signal } from '@angular/core';
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

  /** `bar` when given, else the first part. The admin Overview passes the organization's name as `bar`. */
  readonly barText = this.bar.asReadonly();

  set(parts: readonly string[], options: { readonly bar?: string } = {}): void {
    this.title.setTitle([...parts, SITE_NAME].join(SEPARATOR));
    this.bar.set(options.bar ?? parts[0] ?? SITE_NAME);
  }
}

interface RouteIdentity {
  readonly config: Route | null;
  readonly params: Params;
}

/** The deepest primary route and the params of every route down to it, since a reused child keeps its own params when only its parent's change. */
function identityOf(snapshot: RouterStateSnapshot): RouteIdentity {
  let route = snapshot.root;
  let params: Params = {};
  for (
    let child = route.children.find((c) => c.outlet === PRIMARY_OUTLET);
    child;
    child = route.children.find((c) => c.outlet === PRIMARY_OUTLET)
  ) {
    route = child;
    params = { ...params, ...route.params };
  }
  return { config: route.routeConfig, params };
}

function sameParams(a: Params, b: Params): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Hands a route's `title` to `PageTitle`. A route without one changes nothing, so the public pages' own titles stay. */
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
    this.pageTitle.set(parts);
  }
}
