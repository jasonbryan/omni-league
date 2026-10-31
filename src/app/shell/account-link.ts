import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { initialsOf } from './initials';

/**
 * It exists only in the browser for a signed-in visitor, so a page without one makes no `users.me` query and a server render never reaches it.
 * Nothing shows until `users.me` answers, so a signed-in visitor is not shown "Sign in" in between.
 */
@Component({
  selector: 'app-account-link',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (name() !== undefined) {
      <a
        routerLink="/app"
        data-slot="button"
        class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 ms-auto min-w-0 max-w-36 ps-1 md:max-w-64"
      >
        @if (name(); as name) {
          <span
            aria-hidden="true"
            class="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
            >{{ initials() }}</span
          ><span class="sr-only">Account: </span><span class="truncate">{{ name }}</span>
        } @else {
          Account
        }
      </a>
    }
  `,
})
export class AccountLink {
  private readonly auth = inject(AuthService);
  // Asked only once Convex has accepted the token, so the first answer is the caller's own row.
  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly name = computed(() => {
    const me = this.me.value();
    if (me === undefined) return this.me.error() ? null : undefined;
    return me?.name ?? null;
  });
  protected readonly initials = computed(() => initialsOf(this.name() ?? ''));
}
