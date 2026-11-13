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
import { FormField, form, required } from '@angular/forms/signals';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideArrowRight,
  lucideCalendarX,
  lucideCircleAlert,
  lucideListOrdered,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { map } from 'rxjs';
import { checkTeamName, MAX_TEAM_NAME_LENGTH } from '../../../convex/lib/teamInput';
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
import { ShownUntilValid } from '../core/forms/shown-errors';
import { injectNow } from '../core/now';
import { NotFoundView } from '../not-found/not-found-view';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { publicTournamentPath } from '../organizations/public-tournament/public-tournament-path';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell } from '../shell';
import { HlmAlertImports } from '../ui/alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { HlmFieldImports } from '../ui/field';
import { HlmInputImports } from '../ui/input';
import { HlmSpinner } from '../ui/spinner';
import { RegisterSkeleton } from './register-card';
import { RegisterTournamentCard } from './register-tournament-card';
import {
  registerTournamentState,
  tournamentClosedLine,
  type RegisterTournamentState,
} from './register-tournament-state';
import { registerTournamentTeamPath, teamPath } from './team-paths';
import { type WaitlistPlace, waitlistPlaceOf } from './waitlist-place';

export const REGISTER_TOURNAMENT_MESSAGES = {
  failedTitle: 'The team could not be registered.',
  failedDescription: 'Check your connection and try again.',
  offlineDescription: "Your team name is still here. Try again when you're connected.",
  onTeamTitle: (team: string) => `You’re on ${team} in this tournament.`,
  onTeamDescription:
    'Each person plays on one team per tournament, so there’s nothing to register here.',
  closedTitle: 'Registration for this tournament is closed.',
  waitlistTitle: 'This tournament is full, so your team joins the waitlist.',
  waitlistDescription:
    'Waiting teams keep their place in line. If a place opens, an organizer moves a team from the waitlist into the tournament, and you become its captain.',
  waitlistedTitle: (team: string, position: number) =>
    `${team} is on the waitlist, position ${position}.`,
  waitlistedDescription: (position: number) => {
    const ahead =
      position <= 1
        ? 'Your team is first in line.'
        : position === 2
          ? 'One team is ahead of yours.'
          : `${position - 1} teams are ahead of yours.`;
    return `${ahead} If an organizer gives your team a place, it appears under Your teams, and you can invite your players.`;
  },
} as const;

/** What the page shows after a refused submit, before the query catches up. */
type Refusal = 'closed' | 'onTeam' | 'waitlisted';

type FormAlert = 'offline' | 'failed';

interface NameRefusal {
  field: 'name';
  message: string;
}

function refusalData(failure: unknown): Record<string, unknown> | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
}

function checkedName(name: string): string {
  const checked = checkTeamName(name);
  return checked.ok ? checked.name : name;
}

function nameRefusalOf(data: Record<string, unknown>): NameRefusal | null {
  return data['field'] === 'name' && typeof data['message'] === 'string'
    ? { field: 'name', message: data['message'] }
    : null;
}

@Component({
  selector: 'app-register-tournament-team-page',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    HlmAlertImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinner,
    NgIcon,
    NotFoundView,
    RegisterSkeleton,
    RegisterTournamentCard,
    RouterLink,
    ServerErrorView,
    Shell,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideArrowRight,
      lucideCalendarX,
      lucideCircleAlert,
      lucideListOrdered,
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
          <app-register-skeleton [withNameField]="true" subject="tournament" />
        }
        @default {
          @if (tournament(); as tournament) {
            <app-register-tournament-card
              [tournament]="tournament"
              kicker="Register a team"
              [tournamentHref]="tournamentHref()"
            >
              @switch (state()) {
                @case ('on-team') {
                  @if (tournament.team; as team) {
                    <div
                      #cardAlert
                      hlmAlert
                      [attr.role]="refused() ? 'alert' : 'status'"
                      tabindex="-1"
                    >
                      <ng-icon name="lucideUsers" aria-hidden="true" />
                      <div hlmAlertTitle>{{ messages.onTeamTitle(team.name) }}</div>
                      <div hlmAlertDescription>{{ messages.onTeamDescription }}</div>
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
                @case ('closed') {
                  <div
                    #cardAlert
                    hlmAlert
                    [attr.role]="refused() ? 'alert' : 'status'"
                    tabindex="-1"
                  >
                    <ng-icon name="lucideCalendarX" aria-hidden="true" />
                    <div hlmAlertTitle>{{ messages.closedTitle }}</div>
                    <div hlmAlertDescription>{{ closedLine() }}</div>
                  </div>
                  <a
                    [routerLink]="tournamentHref()"
                    data-slot="button"
                    [class]="outlineButton + ' mt-4 w-full'"
                    ><ng-icon
                      name="lucideArrowLeft"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Back to the tournament page</a
                  >
                }
                @case ('waitlisted') {
                  @if (waitlistPlace(); as place) {
                    <div
                      #cardAlert
                      hlmAlert
                      [attr.role]="refused() ? 'alert' : 'status'"
                      tabindex="-1"
                      class="outline-offset-2 focus:outline-2 focus:outline-ring"
                    >
                      <ng-icon name="lucideListOrdered" aria-hidden="true" />
                      <div hlmAlertTitle>
                        {{ messages.waitlistedTitle(place.teamName, place.position) }}
                      </div>
                      <div hlmAlertDescription>
                        {{ messages.waitlistedDescription(place.position) }}
                      </div>
                    </div>
                    <a
                      [routerLink]="tournamentHref()"
                      data-slot="button"
                      [class]="outlineButton + ' mt-4 w-full'"
                      ><ng-icon
                        name="lucideArrowLeft"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />Back to the tournament page</a
                    >
                  }
                }
                @default {
                  <form novalidate aria-labelledby="register-heading" (submit)="submit($event)">
                    @if (formAlert(); as alert) {
                      @if (alert === 'offline') {
                        <app-admin-offline-alert
                          #formAlertBox
                          [description]="messages.offlineDescription"
                          class="mb-5"
                        />
                      } @else {
                        <app-admin-alert
                          #formAlertBox
                          kind="error"
                          [title]="messages.failedTitle"
                          [description]="messages.failedDescription"
                          class="mb-5"
                        />
                      }
                    }
                    @if (joinsWaitlist()) {
                      <div hlmAlert role="note">
                        <ng-icon name="lucideListOrdered" aria-hidden="true" />
                        <div hlmAlertTitle>{{ messages.waitlistTitle }}</div>
                        <div hlmAlertDescription>{{ messages.waitlistDescription }}</div>
                      </div>
                    } @else {
                      <p class="text-sm text-muted-foreground">
                        You&rsquo;ll be the captain and the team&rsquo;s first player.
                      </p>
                    }
                    <div hlmFieldGroup class="mt-5">
                      <div
                        hlmField
                        [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
                        [attr.data-invalid]="error() ? 'true' : null"
                      >
                        <label hlmFieldLabel for="team-name">Team name</label>
                        <input
                          #nameInput
                          hlmInput
                          id="team-name"
                          type="text"
                          autocomplete="off"
                          [formField]="fields.name"
                          (blur)="shown.left()"
                          [attr.aria-describedby]="
                            error()
                              ? 'team-name-description team-name-error'
                              : 'team-name-description'
                          "
                          [attr.aria-invalid]="error() ? 'true' : null"
                          [attr.data-invalid]="error() ? 'true' : null"
                          [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
                        />
                        <p hlmFieldDescription id="team-name-description">
                          @if (joinsWaitlist()) {
                            Up to {{ maxLength }} characters. Organizers see it while your team
                            waits; it is not public until the team has a place.
                          } @else {
                            Up to {{ maxLength }} characters. Other teams in the tournament see it.
                          }
                        </p>
                        @if (error(); as error) {
                          <div hlmFieldError id="team-name-error">
                            <ng-icon
                              name="lucideCircleAlert"
                              class="mt-0.5 shrink-0 text-base"
                              aria-hidden="true"
                            />
                            <span>{{ error }}</span>
                          </div>
                        }
                      </div>
                    </div>
                    <button
                      type="submit"
                      data-slot="button"
                      [class]="primaryButton + ' mt-6 w-full'"
                      [class.opacity-50]="!online() && !submitting()"
                      [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
                    >
                      @if (submitting()) {
                        <hlm-spinner data-icon="inline-start" />{{
                          joinsWaitlist() ? 'Joining the waitlist…' : 'Registering team…'
                        }}
                      } @else {
                        {{ joinsWaitlist() ? 'Join the waitlist' : 'Register team' }}
                      }
                    </button>
                    <p role="status" class="sr-only">
                      {{ submittingStatus() }}
                    </p>
                  </form>
                }
              }
            </app-register-tournament-card>
          }
        }
      }
    </app-shell>
  `,
})
export class RegisterTournamentTeamPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly registerTeam = injectMutation(api.teams.registerForTournamentOrWaitlist);

  protected readonly messages = REGISTER_TOURNAMENT_MESSAGES;
  protected readonly maxLength = MAX_TEAM_NAME_LENGTH;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly online = injectOnline();
  private readonly now = injectNow();

  private readonly slugs = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => ({
        orgSlug: params.get('orgSlug') ?? '',
        tournamentSlug: params.get('tournamentSlug') ?? '',
      })),
    ),
    { requireSync: true },
  );

  protected readonly path = computed(() => {
    const { orgSlug, tournamentSlug } = this.slugs();
    return registerTournamentTeamPath(orgSlug, tournamentSlug);
  });
  protected readonly tournamentHref = computed(() => {
    const { orgSlug, tournamentSlug } = this.slugs();
    return publicTournamentPath(orgSlug, tournamentSlug);
  });

  private readonly sessionKnown = signal(false);

  // Asked signed out as well, so an unknown tournament shows the not-found view before any sign-in. Signed in, it waits until Convex has
  // accepted the token, so its first answer holds the caller's own team.
  private readonly registration = injectQuery(api.tournaments.getForRegistration, () => {
    if (!this.sessionKnown()) return skipToken;
    if (this.auth.signedIn() && !this.auth.convexAuthenticated()) return skipToken;
    return this.slugs();
  });

  protected readonly tournament = computed(() => this.registration.value() ?? null);

  private readonly refusal = linkedSignal<unknown, Refusal | null>({
    source: this.slugs,
    computation: () => null,
  });
  protected readonly refused = computed(() => this.refusal() !== null);

  private readonly firstState = computed(() =>
    registerTournamentState({
      answer: this.sessionKnown() ? this.registration.value() : undefined,
      signedIn: this.auth.signedIn(),
      nowMs: this.now(),
    }),
  );

  /** Signed out, the page stays on its skeleton while it sends the visitor to sign in. */
  protected readonly state = computed<RegisterTournamentState | 'error'>(() => {
    if (this.registration.error()) return 'error';
    const state = this.firstState();
    if (state === 'signed-out') return 'loading';
    if (state !== 'form' && state !== 'full') return state;
    if (this.joinedWaitlist()) return 'waitlisted';
    const refusal = this.refusal();
    return refusal === 'closed' || refusal === 'waitlisted' ? refusal : state;
  });

  protected readonly joinsWaitlist = computed(() => this.state() === 'full');

  /** The mutation's answer, shown until the query holds the new entry. */
  private readonly joinedWaitlist = linkedSignal<unknown, WaitlistPlace | null>({
    source: this.slugs,
    computation: () => null,
  });

  protected readonly waitlistPlace = computed<WaitlistPlace | null>(
    () => this.tournament()?.waitlist ?? this.joinedWaitlist(),
  );

  protected readonly submittingStatus = computed(() => {
    if (!this.submitting()) return '';
    return this.joinsWaitlist() ? 'Joining the waitlist.' : 'Registering the team.';
  });

  protected readonly closedLine = computed(() => {
    const tournament = this.tournament();
    return tournament ? tournamentClosedLine(tournament) : '';
  });

  private readonly model = signal({ name: '' });
  protected readonly fields = form(this.model, (path) => {
    required(path.name);
  });
  private readonly clientError = computed(() => {
    const checked = checkTeamName(this.model().name);
    return checked.ok ? null : checked.error.message;
  });
  protected readonly shown = new ShownUntilValid(
    () => this.clientError() !== null,
    () => this.fields.name().dirty(),
  );
  private readonly serverError = linkedSignal<string, string | null>({
    source: () => this.model().name,
    computation: () => null,
  });
  protected readonly error = computed(() =>
    this.shown.shown() ? this.clientError() : this.serverError(),
  );

  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
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
      const tournament = this.tournament();
      if (tournament) this.title.setTitle(`Register a team | ${tournament.name} | Omni League`);
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
    const invalid = this.clientError() !== null;
    this.shown.submitted();
    if (invalid) {
      this.focusNameAfterRender();
      return;
    }
    if (!this.online()) {
      this.showAlert('offline');
      return;
    }
    this.submitting.set(true);
    let result: Awaited<ReturnType<typeof this.registerTeam.run>>;
    try {
      result = await this.registerTeam.run({ ...this.slugs(), name: this.model().name });
    } catch (failure) {
      this.submitting.set(false);
      this.showFailure(failure);
      return;
    }
    if (result.status === 'waitlisted') {
      this.submitting.set(false);
      this.joinedWaitlist.set({
        teamName: checkedName(this.model().name),
        position: result.position,
      });
      this.focusCardAlert.set(true);
      return;
    }
    // A finished one-time form is replaced in history, so Back returns to the tournament page.
    await this.router.navigateByUrl(teamPath(result.teamId), {
      replaceUrl: true,
      state: { registered: true },
    });
    this.submitting.set(false);
  }

  private showFailure(failure: unknown): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const data = refusalData(failure);
    const nameRefusal = data && nameRefusalOf(data);
    if (nameRefusal) {
      this.serverError.set(nameRefusal.message);
      this.focusNameAfterRender();
      return;
    }
    const code = data?.['code'];
    if (code === 'registrationClosed') {
      this.refuse('closed');
      return;
    }
    if (code === 'onWaitlist') {
      this.joinedWaitlist.set(waitlistPlaceOf(failure));
      this.refuse('waitlisted');
      return;
    }
    if (code === 'alreadyOnTeam' || code === 'alreadyOnAnotherTeam') {
      this.refuse('onTeam');
      return;
    }
    this.showAlert('failed');
  }

  /** The query answers with the caller's team or waitlist place, or the closed tournament, soon after; the card's alert takes focus once it shows. */
  private refuse(refusal: Refusal): void {
    this.refusal.set(refusal);
    this.focusCardAlert.set(true);
  }

  private showAlert(alert: FormAlert): void {
    this.formAlert.set(alert);
    afterNextRender(() => this.formAlertBox()?.focus(), { injector: this.injector });
  }

  private focusNameAfterRender(): void {
    afterNextRender(() => this.nameInput()?.nativeElement.focus(), { injector: this.injector });
  }
}
