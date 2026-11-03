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
  lucideArrowRight,
  lucideCheck,
  lucideCircleCheck,
  lucideHouse,
  lucideLink2Off,
  lucideLoaderCircle,
  lucideLogOut,
  lucideMailOpen,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import type { TeamInviteAcceptCode } from '../../../convex/lib/teamInviteInput';
import { AuthService } from '../core/auth/auth.service';
import {
  api,
  ConvexOfflineError,
  injectMutation,
  injectOnline,
  injectQuery,
  skipToken,
} from '../core/data/convex';
import { JOIN_TEAM_PATH } from '../invites/capture-invite-token';
import { InviteAlert, type InviteAlertKind } from '../invites/invite-alert';
import { InviteOfflineAlert } from '../invites/invite-offline-alert';
import { TeamInviteTokenStore } from '../invites/invite-token-store';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../organizations/admin/button-classes';
import { formatDay } from '../organizations/admin/format-day';
import { PageLoadStatus } from '../public-layout/page-load-status';
import { injectPageLoadWait } from '../public-layout/page-load-wait';
import { PublicLayout } from '../public-layout/public-layout';
import { ServerErrorView } from '../server-error/server-error-view';

interface TeamInviteSummary {
  teamName: string;
  seasonName: string;
  leagueName: string;
  organizationName: string;
  expiresAt: number;
}

interface JoinedTeam {
  teamId: string;
  teamName: string;
  seasonName: string;
  captainName: string;
}

type View = 'checking' | 'loadFailed' | 'invalid' | 'signedOut' | 'ready' | 'accepted';

type Refusal =
  | { kind: 'emailMismatch' }
  | { kind: 'alreadyOnTeam'; teamId: string }
  | { kind: 'alreadyOnAnotherTeam'; teamName: string }
  | { kind: 'failed' }
  | { kind: 'offline' };

interface RefusalText {
  alert: InviteAlertKind;
  title: string;
  description: string;
}

/** The roster refusals leave the invite pending but nothing to press here. */
const SETTLED: ReadonlySet<Refusal['kind']> = new Set(['alreadyOnTeam', 'alreadyOnAnotherTeam']);

const OFFLINE_DESCRIPTION = "The invite is still waiting. Try again when you're connected.";

function refusalOf(failure: unknown): Refusal | 'invalid' {
  if (failure instanceof ConvexOfflineError) return { kind: 'offline' };
  if (!(failure instanceof ConvexError)) return { kind: 'failed' };
  const data: unknown = failure.data;
  const fields = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const code = fields['code'] as TeamInviteAcceptCode | undefined;
  const text = (key: string) => (typeof fields[key] === 'string' ? fields[key] : '');
  switch (code) {
    case 'invalid':
      return 'invalid';
    case 'emailMismatch':
      return { kind: 'emailMismatch' };
    case 'alreadyOnTeam':
      return { kind: 'alreadyOnTeam', teamId: text('teamId') };
    case 'alreadyOnAnotherTeam':
      return { kind: 'alreadyOnAnotherTeam', teamName: text('teamName') };
    default:
      return { kind: 'failed' };
  }
}

/**
 * `captureTeamInviteToken` has already moved the token into its own `sessionStorage` key and taken it out of the URL, so it is in no `returnTo`, address bar, or request URL.
 * The page sends it only as the argument of `teamInvites.getByToken` and `teamInvites.accept`.
 */
@Component({
  selector: 'app-join-team-page',
  imports: [
    InviteAlert,
    InviteOfflineAlert,
    NgIcon,
    PageLoadStatus,
    PublicLayout,
    RouterLink,
    ServerErrorView,
  ],
  providers: [
    provideIcons({
      lucideArrowRight,
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
                  It may have expired, been revoked, or already been accepted. Ask the team’s
                  captain for a new link.
                </p>
                <a routerLink="/" data-slot="button" [class]="primaryButton + ' mt-8'"
                  ><ng-icon name="lucideHouse" data-icon="inline-start" aria-hidden="true" />Go to
                  the home page</a
                >
              </div>
            }
            @case ('accepted') {
              @if (joined(); as team) {
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
                    You’re on {{ team.teamName }}
                  </h1>
                  <p class="mt-3 text-balance text-muted-foreground">{{ joinedLine() }}</p>
                  <a
                    [routerLink]="['/app', 'teams', team.teamId]"
                    data-slot="button"
                    [class]="primaryButton + ' mt-8'"
                    ><ng-icon
                      name="lucideArrowRight"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Go to {{ team.teamName }}</a
                  >
                </div>
              }
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
                    <p class="mt-4 text-sm font-medium text-muted-foreground">Team invite</p>
                    <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance">
                      Join {{ invite.teamName }}
                    </h1>
                    <p class="mt-2 text-sm text-muted-foreground">
                      You’re invited to play on this team.
                    </p>
                  </div>
                  <dl
                    class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border text-sm md:mx-8"
                  >
                    @for (row of details(); track row.term) {
                      <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                        <dt class="text-muted-foreground">{{ row.term }}</dt>
                        <dd class="font-medium sm:text-end">{{ row.value }}</dd>
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
                        [class]="outlineButton + ' mt-3 w-full'"
                        >Sign in</a
                      >
                    } @else {
                      @if (refusal(); as refusal) {
                        @if (refusal.kind === 'offline') {
                          <app-invite-offline-alert
                            #alert
                            [description]="offlineDescription"
                            class="mb-4"
                          />
                        } @else if (refusalText(); as text) {
                          <app-invite-alert
                            #alert
                            [kind]="text.alert"
                            [title]="text.title"
                            [description]="text.description"
                            class="mb-4"
                          />
                        }
                      }
                      @if (settledLink(); as link) {
                        <a
                          [routerLink]="link.route"
                          data-slot="button"
                          [class]="outlineButton + ' w-full'"
                          >{{ link.label }}</a
                        >
                      } @else {
                        <p class="text-sm text-muted-foreground">
                          Signed in{{ name() ? ' as ' : ''
                          }}<span class="font-medium text-foreground">{{ name() }}</span
                          >.
                        </p>
                        @if (refusal()?.kind === 'emailMismatch') {
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
export class JoinTeamPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly store = inject(TeamInviteTokenStore);
  private readonly title = inject(Title);

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly returnToParams = { returnTo: JOIN_TEAM_PATH };
  protected readonly path = JOIN_TEAM_PATH;
  protected readonly offlineDescription = OFFLINE_DESCRIPTION;

  /** Read again only when the guard captures another link while the page is open; a new token starts the page over. */
  private readonly token = linkedSignal({
    source: this.store.captured,
    computation: () => this.store.read(),
  });

  private readonly invite = injectQuery(api.teamInvites.getByToken, () => {
    const token = this.token();
    return token ? { token } : skipToken;
  });
  // Asked only once Convex has accepted the token, so the first answer is the caller's own row.
  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );
  private readonly acceptInvite = injectMutation(api.teamInvites.accept);

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
  protected readonly joined = linkedSignal<string | null, JoinedTeam | null>({
    source: this.token,
    computation: () => null,
  });

  protected readonly name = computed(() => this.me.value()?.name ?? null);

  /** Keeps the last valid answer: accepting makes `getByToken` answer `invalid` a moment before `accept` returns. */
  protected readonly summary = linkedSignal<
    ReturnType<typeof this.invite.value>,
    TeamInviteSummary | null
  >({
    source: this.invite.value,
    computation: (answer, previous) =>
      answer?.status === 'valid' ? answer : (previous?.value ?? null),
  });

  private readonly phase = computed<View>(() => {
    if (this.joined()) return 'accepted';
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

  protected readonly details = computed(() => {
    const invite = this.summary();
    if (!invite) return [];
    return [
      { term: 'Team', value: invite.teamName },
      { term: 'Season', value: invite.seasonName },
      { term: 'League', value: invite.leagueName },
      { term: 'Organization', value: invite.organizationName },
      { term: 'Expires', value: formatDay(invite.expiresAt) },
    ];
  });

  protected readonly joinedLine = computed(() => {
    const team = this.joined();
    if (!team) return '';
    const captain = team.captainName ? ` ${team.captainName} is the captain.` : '';
    return `You’re on the roster for ${team.seasonName}.${captain}`;
  });

  protected readonly refusalText = computed<RefusalText | null>(() => {
    const refusal = this.refusal();
    const teamName = this.summary()?.teamName ?? '';
    switch (refusal?.kind) {
      case 'emailMismatch':
        return {
          alert: 'notice',
          title: 'This invite was sent to a different email address.',
          description: 'Sign in with that address to accept it.',
        };
      case 'alreadyOnTeam':
        return {
          alert: 'info',
          title: `You’re already on ${teamName}.`,
          description: 'This invite can’t add you twice.',
        };
      case 'alreadyOnAnotherTeam':
        return {
          alert: 'info',
          title: `You’re already on ${refusal.teamName} in this season.`,
          description: `Each person plays on one team per season, so you can’t join ${teamName}.`,
        };
      case 'failed':
        return {
          alert: 'error',
          title: 'The invite could not be accepted.',
          description: 'Check your connection and try again.',
        };
      default:
        return null;
    }
  });

  /** The link holds an id or a path only, never the token. */
  protected readonly settledLink = computed<{ label: string; route: string[] } | null>(() => {
    const refusal = this.refusal();
    if (refusal?.kind === 'alreadyOnTeam' && refusal.teamId) {
      return {
        label: `Go to ${this.summary()?.teamName ?? 'your team'}`,
        route: ['/app', 'teams', refusal.teamId],
      };
    }
    if (refusal && SETTLED.has(refusal.kind)) return { label: 'Go to your teams', route: ['/app'] };
    return null;
  });

  private readonly alert = viewChild<InviteAlert | InviteOfflineAlert>('alert');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    void this.auth.isSignedIn().then(() => this.sessionKnown.set(true));
    effect(() => {
      const view = this.view();
      if (view !== 'loadFailed') {
        const team = this.joined()?.teamName;
        this.title.setTitle(
          view === 'accepted' && team
            ? `Joined ${team} | Omni League`
            : view === 'invalid'
              ? 'Invite unavailable | Omni League'
              : 'Team invite | Omni League',
        );
      }
      // An unusable invite and a roster refusal end this link here. The link may be opened again on this page (`captured` changes), which stores the token again.
      this.store.captured();
      const refusal = this.refusal();
      if (view === 'invalid' || (refusal && SETTLED.has(refusal.kind))) this.store.clear();
    });
  }

  protected async accept(): Promise<void> {
    const token = this.token();
    if (this.accepting() || !token) return;
    // Offline, the button looks disabled but stays focusable: a press explains and sends nothing.
    if (!this.online()) {
      this.refusal.set({ kind: 'offline' });
      this.focusAfterRender('alert');
      return;
    }
    this.refusal.set(null);
    this.accepting.set(true);
    try {
      const result = await this.acceptInvite.run({ token });
      this.store.clear();
      this.joined.set(result);
      this.focusAfterRender('heading');
    } catch (failure) {
      const refusal = refusalOf(failure);
      if (refusal === 'invalid') {
        this.refusedAsInvalid.set(true);
      } else {
        if (SETTLED.has(refusal.kind)) this.store.clear();
        this.refusal.set(refusal);
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
