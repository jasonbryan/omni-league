import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut, lucideRotateCw } from '@ng-icons/lucide';
import { api } from '../../../convex/_generated/api';
import { AuthService } from '../core/auth/auth.service';
import { injectQuery, skipToken } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { Shell } from '../shell';
import { initialsOf } from '../shell/initials';

@Component({
  selector: 'app-account-settings-page',
  imports: [AdminAlert, NgIcon, Shell],
  providers: [provideIcons({ lucideLogOut, lucideRotateCw })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <h1 class="text-2xl font-semibold tracking-tight">Account settings</h1>
        <section
          aria-labelledby="account-details-heading"
          class="mt-4 max-w-xl overflow-hidden md:mt-6 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
            <h2 id="account-details-heading" class="font-semibold">Your details</h2>
          </div>
          <div class="px-4 py-4 md:px-5 md:py-5">
            @if (failed()) {
              <app-admin-alert
                kind="error"
                title="Your account details could not be loaded."
                description="Check your connection and try again."
              >
                <button
                  type="button"
                  data-slot="button"
                  class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 mt-3"
                  (click)="retry()"
                >
                  <ng-icon name="lucideRotateCw" data-icon="inline-start" aria-hidden="true" />Try
                  again
                </button>
              </app-admin-alert>
            } @else if (loading()) {
              <p role="status" class="sr-only">Loading your account details.</p>
              <div aria-hidden="true" class="flex items-center gap-3">
                <div
                  class="rounded-md bg-muted motion-safe:animate-pulse size-10 shrink-0 rounded-full"
                ></div>
                <div class="flex-1">
                  <div
                    class="rounded-md bg-muted motion-safe:animate-pulse h-4 w-40 max-w-full"
                  ></div>
                  <div
                    class="rounded-md bg-muted motion-safe:animate-pulse mt-2 h-3.5 w-56 max-w-full"
                  ></div>
                </div>
              </div>
            } @else if (name(); as name) {
              <div class="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  class="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                  >{{ initials() }}</span
                >
                <p class="min-w-0">
                  <span class="block truncate font-medium">{{ name }}</span>
                  @if (email(); as email) {
                    <span class="block truncate text-sm text-muted-foreground">{{ email }}</span>
                  }
                </p>
              </div>
            }
          </div>
          <div class="border-t border-border px-4 py-3 md:px-5">
            <button
              type="button"
              data-slot="button"
              class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3"
              [attr.aria-disabled]="signingOut() ? 'true' : null"
              (click)="signOut()"
            >
              <ng-icon name="lucideLogOut" data-icon="inline-start" aria-hidden="true" />{{
                signingOut() ? 'Signing out…' : 'Sign out'
              }}
            </button>
          </div>
        </section>
      </div>
    </app-shell>
  `,
})
export class AccountSettingsPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  // Pausing for a render is how the query asks again after an error.
  private readonly paused = signal(false);
  // Asked only once Convex has accepted the token, so the first answer is the caller's own row.
  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() && !this.paused() ? {} : skipToken,
  );

  protected readonly failed = computed(() => this.me.error() !== undefined);
  protected readonly loading = computed(() => this.me.value() === undefined);
  protected readonly name = computed(() => this.me.value()?.name ?? null);
  protected readonly email = computed(() => this.me.value()?.email ?? null);
  protected readonly initials = computed(() => initialsOf(this.name() ?? ''));
  protected readonly signingOut = signal(false);

  protected retry(): void {
    this.paused.set(true);
    afterNextRender(() => this.paused.set(false), { injector: this.injector });
  }

  protected async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/');
    } finally {
      this.signingOut.set(false);
    }
  }
}
