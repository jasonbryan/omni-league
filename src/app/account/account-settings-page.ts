import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut } from '@ng-icons/lucide';
import { AuthService } from '../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { Shell } from '../shell';
import { initialsOf } from '../shell/initials';
import { OUTLINE_BUTTON } from '../ui/button/button-classes';

@Component({
  selector: 'app-account-settings-page',
  imports: [AdminAlert, NgIcon, Shell],
  providers: [provideIcons({ lucideLogOut })],
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
                <a
                  href="/app/account"
                  class="mt-1 inline-flex w-fit items-center rounded-md font-medium text-foreground underline underline-offset-4 pointer-coarse:min-h-11"
                  >Try again</a
                >
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
              [class]="outlineButton"
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

  // Asked only once Convex has accepted the token, so the first answer is the caller's own row.
  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  private readonly noUserRecord = computed(() => this.me.value() === null);
  protected readonly failed = computed(() => this.me.error() !== undefined || this.noUserRecord());
  protected readonly loading = computed(() => this.me.value() === undefined);
  protected readonly name = computed(() => this.me.value()?.name ?? null);
  protected readonly email = computed(() => this.me.value()?.email ?? null);
  protected readonly initials = computed(() => initialsOf(this.name() ?? ''));
  protected readonly signingOut = signal(false);
  protected readonly outlineButton = OUTLINE_BUTTON;

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
