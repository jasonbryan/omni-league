import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut } from '@ng-icons/lucide';
import { api } from '../../../convex/_generated/api';
import { AuthService } from '../core/auth/auth.service';
import { injectQuery, skipToken } from '../core/data/convex';
import { Shell } from '../shell';
import { initialsOf } from '../shell/initials';
import { YourOrganizations } from './your-organizations';

// The top bar's account link (#63) shares it.
export { initialsOf };

/**
 * `/app` (#62), the first signed-in route (`RenderMode.Client`, behind `requireSignedIn`), approved
 * in #96 (design/mockups/62-sign-up.html, state 10): "Signed in as <name>" from `users.me`, and
 * Sign out, which deletes the session and goes to `/`.
 * "Your organizations" (#64) is below the account panel. Sign out's classes are `buttonVariants`
 * output, unmerged, as the mockup draws it (no visible edge), in a static attribute;
 * account-page.spec.ts checks them.
 */
@Component({
  selector: 'app-account-page',
  imports: [NgIcon, Shell, YourOrganizations],
  providers: [provideIcons({ lucideLogOut })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <h1 class="text-2xl font-semibold tracking-tight">Your account</h1>
        @if (name(); as name) {
          <section
            aria-label="Signed-in account"
            class="mt-4 max-w-xl px-4 py-4 md:mt-6 md:px-5 md:py-5 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
          >
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  class="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                  >{{ initials() }}</span
                >
                <p class="min-w-0 text-sm text-muted-foreground">
                  Signed in as<span class="block truncate text-base font-medium text-foreground">{{
                    name
                  }}</span>
                </p>
              </div>
              <button
                type="button"
                data-slot="button"
                class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3"
                [attr.aria-disabled]="signingOut() ? 'true' : null"
                (click)="signOut()"
              >
                <ng-icon name="lucideLogOut" data-icon="inline-start" aria-hidden="true" />Sign out
              </button>
            </div>
          </section>
        }
        <app-your-organizations />
      </div>
    </app-shell>
  `,
})
export class AccountPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Asked only once Convex has accepted the token, so the first answer is the caller's own row.
  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly name = computed(() => this.me.value()?.name ?? null);
  protected readonly initials = computed(() => initialsOf(this.name() ?? ''));
  protected readonly signingOut = signal(false);

  protected async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
    } finally {
      this.signingOut.set(false);
    }
    await this.router.navigateByUrl('/');
  }
}
