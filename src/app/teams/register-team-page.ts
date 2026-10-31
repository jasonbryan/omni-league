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
  lucideLoaderCircle,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { map } from 'rxjs';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
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
import {
  AdminAlert,
  ALERT_DESCRIPTION,
  ALERT_NEUTRAL,
  ALERT_TITLE,
} from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { seasonDates } from '../organizations/league/season-dates';
import { publicSeasonPath } from '../organizations/public-league/public-league-path';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell } from '../shell';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { HlmFieldImports } from '../ui/field';
import { HlmInputImports } from '../ui/input';
import { registerTeamState, type RegisterTeamState } from './register-team-state';
import { registerTeamPath, teamPath } from './team-paths';

export const REGISTER_MESSAGES = {
  failedTitle: 'The team could not be registered.',
  failedDescription: 'Check your connection and try again.',
  offlineDescription: "Your team name is still here. Try again when you're connected.",
  onTeamTitle: (team: string) => `You’re on ${team} in this season.`,
  onTeamDescription:
    'Each person plays on one team per season, so there’s nothing to register here.',
  closedTitle: 'Registration for this season is closed.',
} as const;

/** What the page shows after a refused submit, before the query catches up. */
type Refusal = 'closed' | 'onTeam';

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

function nameRefusalOf(data: Record<string, unknown>): NameRefusal | null {
  return data['field'] === 'name' && typeof data['message'] === 'string'
    ? { field: 'name', message: data['message'] }
    : null;
}

const SKELETON = 'rounded-md bg-muted motion-safe:animate-pulse';

@Component({
  selector: 'app-register-team-page',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    HlmFieldImports,
    HlmInputImports,
    NgIcon,
    NotFoundView,
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
      lucideLoaderCircle,
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
          <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
            <div data-testid="register-skeleton" class="mx-auto w-full max-w-lg">
              <p role="status" class="sr-only">Loading the season.</p>
              <div aria-hidden="true" class="flex h-5 items-center pointer-coarse:h-11">
                <div class="${SKELETON} h-4 w-56"></div>
              </div>
              <div
                aria-hidden="true"
                class="mt-3 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
              >
                <div class="px-5 pt-6 md:px-8 md:pt-8">
                  <div class="${SKELETON} h-5 w-28"></div>
                  <div class="${SKELETON} mt-1 h-8 w-72 max-w-full"></div>
                  <div class="${SKELETON} mt-2 h-5 w-44"></div>
                </div>
                <div
                  class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border md:mx-8"
                >
                  @for (row of skeletonRows; track row) {
                    <div class="flex justify-between gap-x-4 px-3 py-2.5">
                      <div class="${SKELETON} h-5 w-24"></div>
                      <div class="${SKELETON} h-5 w-32"></div>
                    </div>
                  }
                </div>
                <div class="px-5 pt-5 pb-6 md:px-8 md:pb-8">
                  <div class="${SKELETON} h-5 w-full"></div>
                  <div class="${SKELETON} mt-5 h-9 w-full"></div>
                  <div class="${SKELETON} mt-6 h-9 w-full rounded-lg"></div>
                </div>
              </div>
            </div>
          </div>
        }
        @default {
          @if (season(); as season) {
            <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
              <div class="mx-auto w-full max-w-lg">
                <a
                  [routerLink]="seasonHref()"
                  class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
                  ><ng-icon name="lucideArrowLeft" class="text-base" aria-hidden="true" />{{
                    heading()
                  }}</a
                >
                <div
                  class="mt-3 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
                >
                  <div class="px-5 pt-6 md:px-8 md:pt-8">
                    <p class="text-sm font-medium text-muted-foreground">Register a team</p>
                    <h1
                      id="register-heading"
                      class="mt-1 text-2xl font-semibold tracking-tight text-balance"
                    >
                      {{ heading() }}
                    </h1>
                    <p class="mt-2 text-sm text-muted-foreground">{{ season.organizationName }}</p>
                  </div>
                  <dl
                    class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border text-sm md:mx-8"
                  >
                    <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                      <dt class="text-muted-foreground">Dates</dt>
                      <dd class="font-medium sm:text-end">{{ dates() }}</dd>
                    </div>
                    <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                      <dt class="text-muted-foreground">Format</dt>
                      <dd class="font-medium sm:text-end">{{ season.formatName }}</dd>
                    </div>
                    <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                      <dt class="text-muted-foreground">Roster</dt>
                      <dd class="font-medium sm:text-end">
                        At least {{ season.minimumRosterSize }} players
                      </dd>
                    </div>
                    <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                      <dt class="text-muted-foreground">Registration closes</dt>
                      <dd class="font-medium sm:text-end">{{ deadline() }}</dd>
                    </div>
                  </dl>
                  <div class="px-5 pt-5 pb-6 md:px-8 md:pb-8">
                    @switch (state()) {
                      @case ('on-team') {
                        @if (season.team; as team) {
                          <div
                            #cardAlert
                            data-slot="alert"
                            [attr.role]="refused() ? 'alert' : 'status'"
                            tabindex="-1"
                            [class]="neutralAlert"
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
                            }}<ng-icon
                              name="lucideArrowRight"
                              data-icon="inline-end"
                              aria-hidden="true"
                          /></a>
                        }
                      }
                      @case ('closed') {
                        <div
                          #cardAlert
                          data-slot="alert"
                          [attr.role]="refused() ? 'alert' : 'status'"
                          tabindex="-1"
                          [class]="neutralAlert"
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
                        <form
                          novalidate
                          aria-labelledby="register-heading"
                          (submit)="submit($event)"
                        >
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
                          <p class="text-sm text-muted-foreground">
                            You&rsquo;ll be the captain and the team&rsquo;s first player.
                          </p>
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
                                Up to {{ maxLength }} characters. Other teams in the season see it.
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
                              <ng-icon
                                name="lucideLoaderCircle"
                                class="motion-safe:animate-spin"
                                data-icon="inline-start"
                                aria-hidden="true"
                              />Registering team…
                            } @else {
                              Register team
                            }
                          </button>
                          <p role="status" class="sr-only">
                            {{ submitting() ? 'Registering the team.' : '' }}
                          </p>
                        </form>
                      }
                    }
                  </div>
                </div>
              </div>
            </div>
          }
        }
      }
    </app-shell>
  `,
})
export class RegisterTeamPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly registerTeam = injectMutation(api.teams.register);

  protected readonly messages = REGISTER_MESSAGES;
  protected readonly maxLength = MAX_TEAM_NAME_LENGTH;
  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly neutralAlert = ALERT_NEUTRAL;
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
    return registerTeamPath(orgSlug, leagueSlug, seasonSlug);
  });
  protected readonly seasonHref = computed(() => {
    const { orgSlug, leagueSlug, seasonSlug } = this.slugs();
    return publicSeasonPath(orgSlug, leagueSlug, seasonSlug);
  });

  private readonly sessionKnown = signal(false);

  // Asked signed out as well, so an unknown season shows the not-found view before any sign-in. Signed in, it waits until Convex has
  // accepted the token, so its first answer holds the caller's own team.
  private readonly registration = injectQuery(api.seasons.getForRegistration, () => {
    if (!this.sessionKnown()) return skipToken;
    if (this.auth.signedIn() && !this.auth.convexAuthenticated()) return skipToken;
    return this.slugs();
  });

  protected readonly season = computed(() => this.registration.value() ?? null);

  private readonly refusal = linkedSignal<unknown, Refusal | null>({
    source: this.slugs,
    computation: () => null,
  });
  protected readonly refused = computed(() => this.refusal() !== null);

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
    const state = this.firstState();
    if (state === 'signed-out') return 'loading';
    return state === 'form' && this.refusal() === 'closed' ? 'closed' : state;
  });

  protected readonly heading = computed(() => {
    const season = this.season();
    return season ? `${season.leagueName}, ${season.seasonName}` : '';
  });
  protected readonly dates = computed(() => {
    const season = this.season();
    return season ? seasonDates(season.startDate, season.endDate) : '';
  });
  protected readonly deadline = computed(() => {
    const season = this.season();
    return season ? formatCalendarDate(season.registrationDeadline) : '';
  });
  protected readonly closedLine = computed(() => {
    const season = this.season();
    if (!season) return '';
    return season.registrationDeadline < season.startDate
      ? `It closed on ${formatCalendarDate(season.registrationDeadline)}.`
      : `It closed when the season started on ${formatCalendarDate(season.startDate)}.`;
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
      const season = this.season();
      if (season) this.title.setTitle(`Register a team | ${season.seasonName} | Omni League`);
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
    let teamId: string;
    try {
      ({ teamId } = await this.registerTeam.run({ ...this.slugs(), name: this.model().name }));
    } catch (failure) {
      this.submitting.set(false);
      this.showFailure(failure);
      return;
    }
    // A finished one-time form is replaced in history, so Back returns to the season page.
    await this.router.navigateByUrl(teamPath(teamId), {
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
    if (code === 'alreadyOnTeam' || code === 'alreadyOnAnotherTeam') {
      this.refuse('onTeam');
      return;
    }
    this.showAlert('failed');
  }

  /** The query answers with the caller's team or the closed season soon after; the card's alert takes focus once it shows. */
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
