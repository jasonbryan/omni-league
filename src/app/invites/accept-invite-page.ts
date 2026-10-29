import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideCircleCheck,
  lucideHouse,
  lucideLink2Off,
  lucideLoaderCircle,
  lucideLogOut,
  lucideMailOpen,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { api } from '../../../convex/_generated/api';
import type { AcceptRefusal } from '../../../convex/invites';
import type { Role } from '../../../convex/lib/roles';
import { AuthService } from '../core/auth/auth.service';
import {
  ConvexOfflineError,
  injectMutation,
  injectOnline,
  injectQuery,
  skipToken,
} from '../core/data/convex';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../organizations/admin/button-classes';
import { formatDay } from '../organizations/admin/format-day';
import { ServerErrorView } from '../server-error/server-error-view';
import { PageLoadStatus } from '../public-layout/page-load-status';
import { injectPageLoadWait } from '../public-layout/page-load-wait';
import { PublicLayout } from '../public-layout/public-layout';
import { ACCEPT_INVITE_PATH } from './capture-invite-token';
import { InviteAlert } from './invite-alert';
import { InviteTokenStore } from './invite-token-store';

interface InviteSummary {
  organizationName: string;
  role: Role;
  leagueNames: string[];
  expiresAt?: number;
}

/** The slugs are optional so an answer from a backend one release behind still shows the page (the link then goes to `/app`). */
interface AcceptedInvite extends InviteSummary {
  organizationSlug?: string;
  leagues?: { name: string; slug: string }[];
}

type View = 'checking' | 'loadFailed' | 'invalid' | 'signedOut' | 'ready' | 'accepted';

type Refusal = 'emailMismatch' | 'alreadyMember' | 'failed' | 'offline';

const REFUSALS = {
  emailMismatch: {
    title: 'This invite was sent to a different email address.',
    description: 'Sign in with that address to accept it.',
  },
  failed: {
    title: 'The invite could not be accepted.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "The invite is still waiting. Try again when you're connected.",
  },
} as const;

const LIST = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

function refusalCode(failure: unknown): AcceptRefusal | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  const code = typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : null;
  return code === 'invalid' || code === 'emailMismatch' || code === 'alreadyMember' ? code : null;
}

/**
 * `captureInviteToken` has already moved the token into `sessionStorage` and taken it out of the URL, so it is in no `returnTo`, address bar, or request URL.
 * The page sends it only as the argument of `invites.getByToken` and `invites.accept`.
 */
@Component({
  selector: 'app-accept-invite-page',
  imports: [InviteAlert, NgIcon, PageLoadStatus, RouterLink, ServerErrorView, PublicLayout],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleCheck,
      lucideHouse,
      lucideLink2Off,
      lucideLoaderCircle,
      lucideLogOut,
      lucideMailOpen,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      @if (view() === 'loadFailed') {
        <app-server-error-view [retryHref]="path" />
      } @else {
        <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
          @switch (view()) {
            @case ('checking') {
              <div
                data-testid="invite-skeleton"
                data-page-loading
                class="mx-auto w-full max-w-md overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
              >
                <p role="status" class="sr-only">Checking your invite…</p>
                <div class="px-5 pt-6 md:px-8 md:pt-8">
                  <div
                    data-skeleton="icon"
                    aria-hidden="true"
                    class="size-10 rounded-lg bg-muted motion-safe:animate-pulse"
                  ></div>
                  <div
                    aria-hidden="true"
                    class="mt-4 h-5 w-20 rounded-md bg-muted motion-safe:animate-pulse"
                  ></div>
                  <div
                    data-skeleton="heading"
                    aria-hidden="true"
                    class="mt-1 h-8 w-64 max-w-full rounded-md bg-muted motion-safe:animate-pulse"
                  ></div>
                  <div
                    aria-hidden="true"
                    class="mt-2 h-5 w-full rounded-md bg-muted motion-safe:animate-pulse"
                  ></div>
                </div>
                <div
                  aria-hidden="true"
                  class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border md:mx-8"
                >
                  @for (row of skeletonRows; track row) {
                    <div class="flex justify-between gap-x-4 px-3 py-2.5">
                      <div
                        data-skeleton="row"
                        class="h-5 w-24 rounded-md bg-muted motion-safe:animate-pulse"
                      ></div>
                      <div class="h-5 w-32 rounded-md bg-muted motion-safe:animate-pulse"></div>
                    </div>
                  }
                </div>
                <div aria-hidden="true" class="px-5 pt-5 pb-6 md:px-8 md:pb-8">
                  <div class="h-5 w-40 rounded-md bg-muted motion-safe:animate-pulse"></div>
                  <div
                    data-skeleton="button"
                    aria-hidden="true"
                    class="mt-4 h-9 w-full rounded-lg bg-muted motion-safe:animate-pulse"
                  ></div>
                </div>
              </div>
            }
            @case ('invalid') {
              <div
                class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
              >
                <span
                  class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
                >
                  <ng-icon name="lucideLink2Off" class="text-2xl" aria-hidden="true" />
                </span>
                <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                  This invite link can’t be used
                </h1>
                <p class="mt-3 text-balance text-muted-foreground">
                  It may have expired, been revoked, or already been accepted. Ask the org admin who
                  invited you for a new link.
                </p>
                <a routerLink="/" data-slot="button" [class]="primaryButton + ' mt-8'"
                  ><ng-icon name="lucideHouse" data-icon="inline-start" aria-hidden="true" />Go to
                  the home page</a
                >
              </div>
            }
            @case ('accepted') {
              <div
                class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
              >
                <span
                  class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
                >
                  <ng-icon name="lucideCircleCheck" class="text-2xl" aria-hidden="true" />
                </span>
                <h1
                  #heading
                  tabindex="-1"
                  class="mt-6 rounded-md text-2xl font-semibold tracking-tight text-balance md:text-3xl focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                >
                  You’re on the staff of {{ accepted()?.organizationName }}
                </h1>
                <p class="mt-3 text-balance text-muted-foreground">{{ acceptedLine() }}</p>
                <a
                  [routerLink]="destination().link"
                  data-slot="button"
                  [class]="primaryButton + ' mt-8'"
                  >{{ destination().label }}</a
                >
              </div>
            }
            @default {
              @if (summary(); as invite) {
                <div
                  class="mx-auto w-full max-w-md overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
                >
                  <div class="px-5 pt-6 md:px-8 md:pt-8">
                    <span
                      class="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                    >
                      <ng-icon name="lucideMailOpen" class="text-xl" aria-hidden="true" />
                    </span>
                    <p class="mt-4 text-sm font-medium text-muted-foreground">Staff invite</p>
                    <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance">
                      Join {{ invite.organizationName }}
                    </h1>
                    <p class="mt-2 text-sm text-muted-foreground">{{ lead() }}</p>
                  </div>
                  <dl
                    class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border text-sm md:mx-8"
                  >
                    <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                      <dt class="text-muted-foreground">Organization</dt>
                      <dd class="font-medium sm:text-end">{{ invite.organizationName }}</dd>
                    </div>
                    <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                      <dt class="text-muted-foreground">Role</dt>
                      <dd class="font-medium sm:text-end">{{ roleName(invite.role) }}</dd>
                    </div>
                    @if (invite.leagueNames.length > 0) {
                      <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                        <dt class="text-muted-foreground">
                          {{ invite.leagueNames.length === 1 ? 'League' : 'Leagues' }}
                        </dt>
                        <dd class="font-medium sm:text-end">{{ leagueList() }}</dd>
                      </div>
                    }
                    @if (expires(); as expires) {
                      <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                        <dt class="text-muted-foreground">Expires</dt>
                        <dd class="font-medium sm:text-end">{{ expires }}</dd>
                      </div>
                    }
                  </dl>
                  <div class="px-5 pt-5 pb-6 md:px-8 md:pb-8">
                    @if (view() === 'signedOut') {
                      <p class="text-sm text-muted-foreground">
                        To accept, create an account or sign in with the email address this invite
                        was sent to.
                      </p>
                      <a
                        routerLink="/sign-up"
                        [queryParams]="returnToParams"
                        data-slot="button"
                        [class]="primaryButton + ' mt-4 w-full'"
                        >Create an account</a
                      >
                      <a
                        routerLink="/sign-in"
                        [queryParams]="returnToParams"
                        data-slot="button"
                        [class]="outlineButton + ' mt-2 w-full'"
                        >Sign in</a
                      >
                    } @else {
                      @if (refusal(); as refusal) {
                        <app-invite-alert
                          #alert
                          [kind]="
                            refusal === 'alreadyMember'
                              ? 'info'
                              : refusal === 'offline'
                                ? 'offline'
                                : 'error'
                          "
                          [title]="refusalTitle(refusal, invite.organizationName)"
                          [description]="refusalDescription(refusal)"
                          class="mb-4"
                        />
                      }
                      @if (refusal() === 'alreadyMember') {
                        <a routerLink="/app" data-slot="button" [class]="outlineButton + ' w-full'"
                          >Go to your organizations</a
                        >
                      } @else {
                        <p class="text-sm text-muted-foreground">
                          Signed in{{ name() ? ' as ' : ''
                          }}<span class="font-medium text-foreground">{{ name() }}</span
                          >.
                        </p>
                        @if (refusal() === 'emailMismatch') {
                          <button
                            type="button"
                            data-slot="button"
                            [class]="primaryButton + ' mt-4 w-full'"
                            [attr.aria-disabled]="switching() ? 'true' : null"
                            (click)="switchAccount()"
                          >
                            <ng-icon
                              name="lucideLogOut"
                              data-icon="inline-start"
                              aria-hidden="true"
                            />Sign in with a different account
                          </button>
                        } @else {
                          <button
                            type="button"
                            data-slot="button"
                            [class]="
                              online()
                                ? primaryButton + ' mt-4 w-full'
                                : primaryButton + ' mt-4 w-full opacity-50'
                            "
                            [attr.aria-disabled]="accepting() || !online() ? 'true' : null"
                            (click)="accept()"
                          >
                            @if (accepting()) {
                              <ng-icon
                                name="lucideLoaderCircle"
                                class="motion-safe:animate-spin"
                                data-icon="inline-start"
                                aria-hidden="true"
                              />Accepting…
                            } @else {
                              <ng-icon
                                name="lucideCheck"
                                data-icon="inline-start"
                                aria-hidden="true"
                              />Accept invite
                            }
                          </button>
                          <p role="status" class="sr-only">
                            {{ accepting() ? 'Accepting the invite.' : '' }}
                          </p>
                        }
                      }
                    }
                  </div>
                </div>
              }
            }
          }
        </div>
      }
      <app-page-load-status [stalled]="stalled()" />
    </app-public-layout>
  `,
})
export class AcceptInvitePage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly store = inject(InviteTokenStore);
  private readonly title = inject(Title);

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly returnToParams = { returnTo: ACCEPT_INVITE_PATH };
  protected readonly path = ACCEPT_INVITE_PATH;

  /**
   * The stored token: the route guard has already moved it out of the URL. It is read again only
   * when the guard captures another link while the page is open, and a new token starts the page
   * over (the signals below follow it).
   */
  private readonly token = linkedSignal({
    source: this.store.captured,
    computation: () => this.store.read(),
  });

  private readonly invite = injectQuery(api.invites.getByToken, () => {
    const token = this.token();
    return token ? { token } : skipToken;
  });
  // Asked only once Convex has accepted the token, so the first answer is the caller's own row.
  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );
  private readonly acceptInvite = injectMutation(api.invites.accept);

  private readonly sessionKnown = signal(false);
  protected readonly accepting = signal(false);
  protected readonly online = injectOnline();
  protected readonly switching = signal(false);
  protected readonly refusal = linkedSignal<string | null, Refusal | null>({
    source: this.token,
    computation: () => null,
  });
  private readonly refusedAsInvalid = linkedSignal<string | null, boolean>({
    source: this.token,
    computation: () => false,
  });
  protected readonly accepted = linkedSignal<string | null, AcceptedInvite | null>({
    source: this.token,
    computation: () => null,
  });

  protected readonly name = computed(() => this.me.value()?.name ?? null);

  /**
   * The invite being shown. It keeps the last valid answer: accepting makes `getByToken` answer
   * `invalid` a moment before `accept` returns, and the page must not flash the invalid view.
   */
  protected readonly summary = linkedSignal<
    ReturnType<typeof this.invite.value>,
    InviteSummary | null
  >({
    source: this.invite.value,
    computation: (answer, previous) =>
      answer?.status === 'valid' ? answer : (previous?.value ?? null),
  });

  private readonly phase = computed<View>(() => {
    if (this.accepted()) return 'accepted';
    if (!this.token() || this.refusedAsInvalid()) return 'invalid';
    if (this.accepting() || this.refusal() !== null) return 'ready';
    const answer = this.invite.value();
    if (answer === undefined) return this.invite.error() ? 'loadFailed' : 'checking';
    if (answer.status === 'invalid') return 'invalid';
    if (!this.sessionKnown()) return 'checking';
    if (!this.auth.signedIn()) return 'signedOut';
    if (!this.auth.convexAuthenticated() || this.me.value() === undefined) return 'checking';
    return 'ready';
  });

  // Offline, the offline note already explains the wait, so none runs.
  private readonly waitedOut = injectPageLoadWait(
    () => this.phase() === 'checking' && this.online(),
    () => this.token(),
  );
  protected readonly stalled = computed(() => this.phase() === 'checking' && this.waitedOut());

  protected readonly view = computed<View>(() => (this.stalled() ? 'loadFailed' : this.phase()));

  protected readonly lead = computed(() => {
    const invite = this.summary();
    if (invite?.role === 'orgAdmin') {
      return 'You’re invited to help manage the organization as an org admin.';
    }
    const many = (invite?.leagueNames.length ?? 0) > 1;
    return `You’re invited to run ${many ? 'leagues' : 'a league'} as a league organizer.`;
  });
  protected readonly leagueList = computed(() => LIST.format(this.summary()?.leagueNames ?? []));
  protected readonly expires = computed(() => {
    const at = this.summary()?.expiresAt;
    return at === undefined ? null : formatDay(at);
  });
  protected readonly acceptedLine = computed(() => {
    const done = this.accepted();
    if (done?.role === 'orgAdmin') return 'You’re an org admin.';
    return `You’re a league organizer for ${LIST.format(done?.leagueNames ?? [])}.`;
  });

  /** The link holds slugs only, never the token. */
  protected readonly destination = computed<{ label: string; link: string[] }>(() => {
    const done = this.accepted();
    const organization = done?.organizationSlug;
    if (done && organization) {
      if (done.role === 'orgAdmin') {
        return {
          label: `Open ${done.organizationName}`,
          link: ['/app', 'organizations', organization],
        };
      }
      const [league, ...others] = done.leagues ?? [];
      if (league && others.length === 0) {
        return {
          label: `Open ${league.name}`,
          link: ['/app', 'organizations', organization, 'leagues', league.slug],
        };
      }
    }
    return { label: 'Go to your organizations', link: ['/app'] };
  });

  private readonly alert = viewChild(InviteAlert);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    void this.auth.isSignedIn().then(() => this.sessionKnown.set(true));
    effect(() => {
      const view = this.view();
      if (view !== 'loadFailed') {
        this.title.setTitle(
          view === 'accepted'
            ? 'Invite accepted | Omni League'
            : view === 'invalid'
              ? 'Invite unavailable | Omni League'
              : 'Staff invite | Omni League',
        );
      }
      // An unusable invite is refused for good: nothing more to accept with this token. The link
      // may be opened again on this page (`captured` changes), which stores the token again.
      this.store.captured();
      if (view === 'invalid' || this.refusal() === 'alreadyMember') this.store.clear();
    });
  }

  protected roleName(role: Role): string {
    return role === 'orgAdmin' ? 'Org admin' : 'League organizer';
  }

  protected refusalTitle(refusal: Refusal, organizationName: string): string {
    return refusal === 'alreadyMember'
      ? `You’re already on the staff of ${organizationName}.`
      : REFUSALS[refusal].title;
  }

  protected refusalDescription(refusal: Refusal): string {
    return refusal === 'alreadyMember'
      ? 'This invite can’t change your role. Ask an org admin if it should change.'
      : REFUSALS[refusal].description;
  }

  protected async accept(): Promise<void> {
    const token = this.token();
    if (this.accepting() || !token) return;
    // Offline, the button looks disabled but stays focusable: a press explains and sends nothing.
    if (!this.online()) {
      this.refusal.set('offline');
      this.focusAfterRender('alert');
      return;
    }
    this.refusal.set(null);
    this.accepting.set(true);
    try {
      const result = await this.acceptInvite.run({ token });
      this.store.clear();
      this.accepted.set(result);
      this.focusAfterRender('heading');
    } catch (failure) {
      const code = refusalCode(failure);
      if (code === 'invalid') {
        this.refusedAsInvalid.set(true);
      } else {
        if (code === 'alreadyMember') this.store.clear();
        this.refusal.set(code ?? (failure instanceof ConvexOfflineError ? 'offline' : 'failed'));
        this.focusAfterRender('alert');
      }
    } finally {
      this.accepting.set(false);
    }
  }

  /** Signs out, then opens sign-in; the token stays in `sessionStorage`, out of `returnTo`. */
  protected async switchAccount(): Promise<void> {
    if (this.switching()) return;
    this.switching.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigate(['/sign-in'], { queryParams: this.returnToParams });
    } finally {
      this.switching.set(false);
    }
  }

  private focusAfterRender(target: 'alert' | 'heading'): void {
    afterNextRender(
      () => {
        if (target === 'alert') this.alert()?.focus();
        else this.heading()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
