import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
} from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { injectOnline } from '../core/data/convex';
import { NotSavedView } from '../offline/not-saved-view';
import { ServerErrorView } from './server-error-view';

/** A fragment can hold an invite token, and `?ott=` is a one-time sign-in token. */
function withoutSecrets(url: UrlTree): UrlTree {
  const queryParams = { ...url.queryParams };
  delete queryParams['ott'];
  return new UrlTree(url.root, queryParams, null);
}

/** The router shows it at the address of the page that failed to load, which Try again links to. */
@Component({
  selector: 'app-page-unavailable-view',
  imports: [NotSavedView, ServerErrorView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (online()) {
      <app-server-error-view [retryHref]="retryHref()" />
    } @else {
      <app-not-saved-view [retryHref]="retryHref()" />
    }
  `,
})
export class PageUnavailableView {
  private readonly router = inject(Router);
  protected readonly online = injectOnline();
  protected readonly retryHref = computed(() => {
    const navigation = this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation();
    const asked = navigation?.extras.browserUrl ?? navigation?.finalUrl;
    if (asked === undefined) return '/';
    const url = typeof asked === 'string' ? this.router.parseUrl(asked) : asked;
    return this.router.serializeUrl(withoutSecrets(url));
  });

  constructor() {
    // What was pressed led here, so the heading takes focus (ux.md, Feedback). The read phase runs after the
    // focus move to `<main>` after a route change; a page load leaves the first Tab for the skip link.
    if (!this.router.navigated) return;
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender({ read: () => host.querySelector<HTMLElement>('h1')?.focus() });
  }
}
