import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUserRound } from '@ng-icons/lucide';
import { AuthService } from '../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { injectCurrentUrl } from './current-url';
import { initialsOf } from './initials';
import { pathWithoutQueryOrTrailingSlash } from './url-path';

const ACCOUNT_PATH = '/app/account';
const PULSE = 'rounded-md bg-muted motion-safe:animate-pulse';

/**
 * `users.me` is asked only once Convex has accepted the token, so the first answer is the caller's own and a shared device never shows the previous user's email.
 */
@Component({
  selector: 'app-account-row',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideUserRound })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (state() === 'loading') {
      <span role="status" class="sr-only">Loading your account.</span>
      @if (variant() === 'sidebar') {
        <div aria-hidden="true" class="flex min-h-11 items-center gap-3 p-2">
          <span [class]="pulse + ' size-9 shrink-0 rounded-full'"></span>
          <span class="min-w-0 flex-1">
            <span [class]="pulse + ' block h-4 w-28 max-w-full'"></span>
            <span [class]="pulse + ' mt-1.5 block h-3 w-36 max-w-full'"></span>
          </span>
        </div>
      } @else {
        <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center">
          <span [class]="pulse + ' size-9 rounded-full'"></span>
        </span>
      }
    } @else if (variant() === 'sidebar') {
      <a
        [routerLink]="path"
        [attr.aria-current]="current() ? 'page' : null"
        class="flex min-h-11 items-center gap-3 rounded-lg p-2 hover:bg-muted"
        [class.bg-sidebar-accent]="current()"
      >
        @if (state() === 'ready') {
          <span aria-hidden="true" [class]="avatar + ' size-9 text-sm'">{{ initials() }}</span>
          <span class="min-w-0 flex-1"
            ><span class="sr-only">Account settings: </span
            ><span class="block truncate text-sm font-medium">{{ name() }}</span>
            @if (email(); as email) {
              <span class="block truncate text-xs text-muted-foreground">{{ email }}</span>
            }
          </span>
        } @else {
          <span aria-hidden="true" [class]="avatar + ' size-9'"
            ><ng-icon name="lucideUserRound" class="text-lg" aria-hidden="true"
          /></span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">Account settings</span>
        }
      </a>
    } @else {
      <a
        [routerLink]="path"
        [attr.aria-current]="current() ? 'page' : null"
        class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
      >
        @if (state() === 'ready') {
          <span aria-hidden="true" [class]="avatar + ' size-9 text-sm'">{{ initials() }}</span
          ><span class="sr-only">Account settings: {{ name() }}</span>
        } @else {
          <span aria-hidden="true" [class]="avatar + ' size-9'"
            ><ng-icon name="lucideUserRound" class="text-lg" aria-hidden="true" /></span
          ><span class="sr-only">Account settings</span>
        }
      </a>
    }
  `,
})
export class AccountRow {
  readonly variant = input<'sidebar' | 'slimBar'>('sidebar');

  private readonly auth = inject(AuthService);
  private readonly url = injectCurrentUrl();

  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly path = ACCOUNT_PATH;
  protected readonly pulse = PULSE;
  protected readonly avatar =
    'flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground';

  protected readonly state = computed<'loading' | 'ready' | 'failed'>(() => {
    if (!this.auth.convexAuthenticated()) return 'loading';
    if (this.me.error()) return 'failed';
    const me = this.me.value();
    if (me === undefined) return 'loading';
    return me === null ? 'failed' : 'ready';
  });
  protected readonly name = computed(() => this.me.value()?.name ?? '');
  protected readonly email = computed(() => this.me.value()?.email ?? '');
  protected readonly initials = computed(() => initialsOf(this.name()));
  protected readonly current = computed(
    () => pathWithoutQueryOrTrailingSlash(this.url()) === ACCOUNT_PATH,
  );
}
