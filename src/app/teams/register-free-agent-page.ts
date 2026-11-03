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
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideArrowRight,
  lucideCalendarX,
  lucideHourglass,
  lucideLoaderCircle,
  lucideUser,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { map } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { SIGN_IN_PATH } from '../core/auth/guards';
import {
  api,
  ConvexOfflineError,
  injectMutation,
  injectOnline,
  injectQuery,
  skipToken,
} from '../core/data/convex';
import { injectNow } from '../core/now';
import { NotFoundView } from '../not-found/not-found-view';
import {
  AdminAlert,
  ALERT_DESCRIPTION,
  ALERT_NEUTRAL,
  ALERT_TITLE,
} from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { formatDay } from '../organizations/admin/format-day';
import { publicSeasonPath } from '../organizations/public-league/public-league-path';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell } from '../shell';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { RegisterCard, RegisterSkeleton } from './register-card';
import {
  registerTeamState,
  registrationClosedLine,
  type RegisterTeamState,
} from './register-team-state';
import { registerFreeAgentPath, teamPath } from './team-paths';

export const FREE_AGENT_MESSAGES = {
  failedTitle: 'You could not be registered.',
  failedDescription: 'Check your connection and try again.',
  offlineDescription: "You're not registered yet. Try again when you're connected.",
  waitingTitle: 'You’re registered as a free agent.',
  waitingDescription:
    'An organizer will place you on a team. It will then appear under Your teams.',
  onTeamTitle: (team: string) => `You’re on ${team} in this season.`,
  onTeamDescription:
    'Each person plays on one team per season, so there’s no need to register as a free agent.',
  closedTitle: 'Registration for this season is closed.',
  closedInvite: 'To play on a team that has already registered, ask its captain for an invite.',
} as const;

/** What the page shows after a refused submit, before the query catches up. */
type Refusal = 'closed' | 'onTeam' | 'waiting';

type FormAlert = 'offline' | 'failed';

function refusalOf(failure: unknown): Refusal | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  const code = typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : null;
  switch (code) {
    case 'registrationClosed':
      return 'closed';
    case 'alreadyOnTeam':
    case 'alreadyOnAnotherTeam':
      return 'onTeam';
    case 'alreadyFreeAgent':
      return 'waiting';
    default:
      return null;
  }
}

@Component({
  selector: 'app-register-free-agent-page',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    NgIcon,
    NotFoundView,
    RegisterCard,
    RegisterSkeleton,
    RouterLink,
    ServerErrorView,
    Shell,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideArrowRight,
      lucideCalendarX,
      lucideHourglass,
      lucideLoaderCircle,
      lucideUser,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @switch (state()) {
        @case ('not-found') {
          <app-not-found-view />
        }
        @case ('error') {
          <app-server-error-view [retryHref]="path()" />
        }
        @case ('loading') {
          <app-register-skeleton />
        }
        @default {
          @if (season(); as season) {
            <app-register-card
              [season]="season"
              kicker="Register as a free agent"
              [seasonHref]="seasonHref()"
            >
              @switch (state()) {
                @case ('on-team') {
                  @if (season.team; as team) {
                    <div
                      #cardAlert
                      data-slot="alert"
                      [attr.role]="refusal() ? 'alert' : 'status'"
                      tabindex="-1"
                      [class]="cardAlertClass"
                    >
                      <ng-icon name="lucideUsers" aria-hidden="true" />
                      <div data-slot="alert-title" [class]="alertTitle">
                        {{ messages.onTeamTitle(team.name) }}
                      </div>
                      <div data-slot="alert-description" [class]="alertDescription">
                        {{ messages.onTeamDescription }}
                      </div>
                    </div>
                    <a
                      [routerLink]="teamHref(team.teamId)"
                      data-slot="button"
                      [class]="primaryButton + ' mt-4 w-full'"
                      >Go to {{ team.name
                      }}<ng-icon name="lucideArrowRight" data-icon="inline-end" aria-hidden="true"
                    /></a>
                  }
                }
                @case ('waiting') {
                  <div
                    #cardAlert
                    data-slot="alert"
                    role="status"
                    tabindex="-1"
                    [class]="cardAlertClass"
                  >
                    <ng-icon name="lucideHourglass" aria-hidden="true" />
                    <div data-slot="alert-title" [class]="alertTitle">
                      {{ messages.waitingTitle }}
                    </div>
                    <div data-slot="alert-description" [class]="alertDescription">
                      {{ waitingLine() }}
                    </div>
                  </div>
                  <a
                    [routerLink]="seasonHref()"
                    data-slot="button"
                    [class]="outlineButton + ' mt-4 w-full'"
                    ><ng-icon
                      name="lucideArrowLeft"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Back to the season page</a
                  >
                }
                @case ('closed') {
                  <div
                    #cardAlert
                    data-slot="alert"
                    [attr.role]="refusal() ? 'alert' : 'status'"
                    tabindex="-1"
                    [class]="cardAlertClass"
                  >
                    <ng-icon name="lucideCalendarX" aria-hidden="true" />
                    <div data-slot="alert-title" [class]="alertTitle">
                      {{ messages.closedTitle }}
                    </div>
                    <div data-slot="alert-description" [class]="alertDescription">
                      {{ closedLine() }}
                    </div>
                  </div>
                  <a
                    [routerLink]="seasonHref()"
                    data-slot="button"
                    [class]="outlineButton + ' mt-4 w-full'"
                    ><ng-icon
                      name="lucideArrowLeft"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Back to the season page</a
                  >
                }
                @default {
                  <form novalidate aria-labelledby="register-heading" (submit)="submit($event)">
                    @if (formAlert(); as alert) {
                      @if (alert === 'offline') {
                        <app-admin-offline-alert
                          #formAlertBox
                          [description]="messages.offlineDescription"
                          class="mb-4"
                        />
                      } @else {
                        <app-admin-alert
                          #formAlertBox
                          kind="error"
                          [title]="messages.failedTitle"
                          [description]="messages.failedDescription"
                          class="mb-4"
                        />
                      }
                    }
                    <p class="text-sm text-muted-foreground">
                      You register on your own, and an organizer places you on a team that needs
                      players. You&rsquo;re not on a roster, and owe nothing, until then.
                    </p>
                    <button
                      type="submit"
                      data-slot="button"
                      [class]="primaryButton + ' mt-6 w-full'"
                      [class.opacity-50]="!online() && !submitting()"
                      [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
                    >
                      @if (submitting()) {
                        <ng-icon
                          name="lucideLoaderCircle"
                          class="motion-safe:animate-spin"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Registering…
                      } @else {
                        <ng-icon
                          name="lucideUser"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Register as a free agent
                      }
                    </button>
                    <p role="status" class="sr-only">
                      {{ submitting() ? 'Registering you as a free agent.' : '' }}
                    </p>
                  </form>
                }
              }
            </app-register-card>
          }
        }
      }
    </app-shell>
  `,
})
export class RegisterFreeAgentPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly register = injectMutation(api.freeAgents.register);

  protected readonly messages = FREE_AGENT_MESSAGES;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  // The ring shows on the status that takes focus after a press, because the pressed button has gone.
  protected readonly cardAlertClass = `${ALERT_NEUTRAL} outline-offset-2 focus:outline-2 focus:outline-ring`;
  protected readonly alertTitle = ALERT_TITLE;
  protected readonly alertDescription = ALERT_DESCRIPTION;
  protected readonly online = injectOnline();
  private readonly now = injectNow();

  private readonly slugs = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        leagueSlug: params.get('leagueSlug') ?? '',
        seasonSlug: params.get('seasonSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  protected readonly path = computed(() => {
    const { orgSlug, leagueSlug, seasonSlug } = this.slugs();
    return registerFreeAgentPath(orgSlug, leagueSlug, seasonSlug);
  });
  protected readonly seasonHref = computed(() => {
    const { orgSlug, leagueSlug, seasonSlug } = this.slugs();
    return publicSeasonPath(orgSlug, leagueSlug, seasonSlug);
  });

  private readonly sessionKnown = signal(false);

  // Asked signed out as well, so an unknown season shows the not-found view before any sign-in. Signed in, it waits until Convex has
  // accepted the token, so its first answer holds the caller's own team and registration.
  private readonly registration = injectQuery(api.seasons.getForRegistration, () => {
    if (!this.sessionKnown()) return skipToken;
    if (this.auth.signedIn() && !this.auth.convexAuthenticated()) return skipToken;
    return this.slugs();
  });

  protected readonly season = computed(() => this.registration.value() ?? null);

  protected readonly refusal = linkedSignal<unknown, Refusal | null>({
    source: this.slugs,
    computation: () => null,
  });
  /** The time `register` answered, shown until the query holds the new row. */
  private readonly registeredAt = linkedSignal<unknown, number | null>({
    source: this.slugs,
    computation: () => null,
  });

  private readonly firstState = computed(() =>
    registerTeamState({
      answer: this.sessionKnown() ? this.registration.value() : undefined,
      signedIn: this.auth.signedIn(),
      nowMs: this.now(),
    }),
  );

  /** Signed out, the page stays on its skeleton while it sends the visitor to sign in. */
  protected readonly state = computed<RegisterTeamState | 'error'>(() => {
    if (this.registration.error()) return 'error';
    const first = this.firstState();
    const state = first === 'full' ? 'form' : first;
    if (state === 'signed-out') return 'loading';
    if (state !== 'form') return state;
    if (this.registeredAt() !== null || this.refusal() === 'waiting') return 'waiting';
    return this.refusal() === 'closed' ? 'closed' : state;
  });

  protected readonly waitingLine = computed(() => {
    const registeredAt = this.season()?.freeAgent?.registeredAt ?? this.registeredAt();
    const { waitingDescription } = FREE_AGENT_MESSAGES;
    return registeredAt === null
      ? waitingDescription
      : `${waitingDescription} Registered ${formatDay(registeredAt)}.`;
  });
  protected readonly closedLine = computed(() => {
    const season = this.season();
    return season ? `${registrationClosedLine(season)} ${FREE_AGENT_MESSAGES.closedInvite}` : '';
  });

  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  private readonly formAlertBox = viewChild<AdminAlert | AdminOfflineAlert>('formAlertBox');
  private readonly cardAlert = viewChild<ElementRef<HTMLElement>>('cardAlert');
  private readonly focusCardAlert = signal(false);

  constructor() {
    void this.auth.isSignedIn().then(() => this.sessionKnown.set(true));
    effect(() => {
      if (this.firstState() !== 'signed-out') return;
      void this.router.navigate([SIGN_IN_PATH], {
        queryParams: { returnTo: this.path() },
        replaceUrl: true,
      });
    });
    // The not-found and server-error views set their own title.
    effect(() => {
      const season = this.season();
      if (season) {
        this.title.setTitle(`Register as a free agent | ${season.seasonName} | Omni League`);
      }
    });
    effect(() => {
      const alert = this.cardAlert();
      if (!this.focusCardAlert() || !alert) return;
      alert.nativeElement.focus();
      this.focusCardAlert.set(false);
    });
  }

  protected teamHref(teamId: string): string {
    return teamPath(teamId);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.formAlert.set(null);
    if (!this.online()) {
      this.showAlert('offline');
      return;
    }
    this.submitting.set(true);
    try {
      const { registeredAt } = await this.register.run(this.slugs());
      this.registeredAt.set(registeredAt);
      this.focusCardAlert.set(true);
    } catch (failure) {
      this.showFailure(failure);
    } finally {
      this.submitting.set(false);
    }
  }

  private showFailure(failure: unknown): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const refusal = refusalOf(failure);
    if (!refusal) {
      this.showAlert('failed');
      return;
    }
    // The query answers with the caller's row, team, or the closed season soon after; the card's alert takes focus once it shows.
    this.refusal.set(refusal);
    this.focusCardAlert.set(true);
  }

  private showAlert(alert: FormAlert): void {
    this.formAlert.set(alert);
    afterNextRender(() => this.formAlertBox()?.focus(), { injector: this.injector });
  }
}
