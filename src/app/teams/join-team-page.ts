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
import { FormField } from '@angular/forms/signals';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCheck,
  lucideCircleAlert,
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
import { MousePressKeepsFocus } from '../core/forms/mouse-press-keeps-focus';
import { ShownUntilValid } from '../core/forms/shown-errors';
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
import {
  DESCRIPTION,
  FIELD,
  FIELD_CONTENT,
  FIELD_ERROR,
  FIELD_HORIZONTAL,
  FIELD_SET,
  INPUT,
  LABEL,
  LEGEND,
} from '../organizations/admin/field-classes';
import { formatDay } from '../organizations/admin/format-day';
import { PageLoadStatus } from '../public-layout/page-load-status';
import { injectPageLoadWait } from '../public-layout/page-load-wait';
import { PublicLayout } from '../public-layout/public-layout';
import { ServerErrorView } from '../server-error/server-error-view';
import { Checkbox } from '../ui/checkbox';
import { MinorNameErrorText } from './minor-name-error-text';
import { MinorNameForm, minorNameRefusalOf, type MinorNameError } from './minor-name-form';

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
  joinedSelf: boolean;
  minorName: string | null;
}

type View = 'checking' | 'loadFailed' | 'invalid' | 'signedOut' | 'ready' | 'accepted';

type Refusal =
  | { kind: 'emailMismatch' }
  | { kind: 'alreadyOnTeam'; teamId: string }
  | { kind: 'alreadyOnAnotherTeam'; teamName: string }
  | { kind: 'waitingFreeAgent' }
  | { kind: 'teamFull' }
  | { kind: 'minorName'; error: MinorNameError }
  | { kind: 'failed' }
  | { kind: 'offline' };

interface RefusalText {
  alert: InviteAlertKind;
  title: string;
  description: string;
}

/** This refusal leaves the invite pending but nothing to press here. */
const SETTLED: ReadonlySet<Refusal['kind']> = new Set(['alreadyOnTeam']);

/** The one-team and free-agent rules stop only the person's own entry, so a minor can still be added. */
type SelfBlocked = { kind: 'otherTeam'; teamName: string } | { kind: 'freeAgent' };

const OFFLINE_DESCRIPTION = "The invite is still waiting. Try again when you're connected.";

function refusalOf(failure: unknown): Refusal | 'invalid' {
  if (failure instanceof ConvexOfflineError) return { kind: 'offline' };
  if (!(failure instanceof ConvexError)) return { kind: 'failed' };
  const minorName = minorNameRefusalOf(failure);
  if (minorName) return { kind: 'minorName', error: minorName };
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
    case 'waitingFreeAgent':
      return { kind: 'waitingFreeAgent' };
    case 'teamFull':
      return { kind: 'teamFull' };
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
    Checkbox,
    FormField,
    InviteAlert,
    InviteOfflineAlert,
    MinorNameErrorText,
    MousePressKeepsFocus,
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
      lucideCircleAlert,
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
                    {{ joinedHeading() }}
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
                      @if (settledLink(); as link) {
                        @if (refusalText(); as text) {
                          <app-invite-alert
                            #alert
                            [kind]="text.alert"
                            [title]="text.title"
                            [description]="text.description"
                            class="mb-4"
                          />
                        }
                        <a
                          [routerLink]="link.route"
                          data-slot="button"
                          [class]="outlineButton + ' w-full'"
                          >{{ link.label }}</a
                        >
                      } @else if (refusal()?.kind === 'emailMismatch') {
                        @if (refusalText(); as text) {
                          <app-invite-alert
                            #alert
                            [kind]="text.alert"
                            [title]="text.title"
                            [description]="text.description"
                            class="mb-4"
                          />
                        }
                        <p class="text-sm text-muted-foreground">
                          Signed in{{ name() ? ' as ' : ''
                          }}<span class="font-medium text-foreground">{{ name() }}</span
                          >.
                        </p>
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
                        <form novalidate aria-label="Accept the invite" (submit)="accept($event)">
                          @if (refusal()?.kind === 'offline') {
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
                          <p class="text-sm text-muted-foreground">
                            Signed in{{ name() ? ' as ' : ''
                            }}<span class="font-medium text-foreground">{{ name() }}</span
                            >.
                          </p>
                          <fieldset
                            id="choices"
                            data-slot="field-set"
                            [attr.aria-describedby]="
                              choiceError()
                                ? 'choices-description choices-error'
                                : 'choices-description'
                            "
                            [attr.data-invalid]="choiceError() ? 'true' : null"
                            [class]="fieldSetClass + ' mt-4'"
                          >
                            <legend
                              data-slot="field-legend"
                              data-variant="label"
                              [class]="legendClass + (choiceError() ? ' text-destructive' : '')"
                            >
                              Who’s joining?
                            </legend>
                            <p
                              data-slot="field-description"
                              id="choices-description"
                              [class]="descriptionClass + ' -mt-1.5'"
                            >
                              Choose one or both.
                            </p>
                            <div data-slot="checkbox-group" class="grid gap-3">
                              <div
                                role="group"
                                data-slot="field"
                                data-orientation="horizontal"
                                [attr.data-disabled]="selfBlocked() ? 'true' : null"
                                [attr.data-matches-spartan-invalid]="choiceError() ? 'true' : null"
                                [class]="fieldHorizontalClass"
                              >
                                <app-checkbox
                                  #joinSelfBox
                                  controlId="join-self"
                                  describedBy="join-self-description"
                                  [checked]="joinSelfChosen()"
                                  (checkedChange)="joinSelf.set($event)"
                                  [disabled]="selfBlocked() !== null"
                                  [showInvalid]="choiceError()"
                                />
                                <div data-slot="field-content" [class]="contentClass">
                                  <label
                                    for="join-self"
                                    data-slot="field-label"
                                    [class]="labelClass"
                                    >Join the roster myself</label
                                  >
                                  <p
                                    data-slot="field-description"
                                    id="join-self-description"
                                    [class]="descriptionClass"
                                  >
                                    {{ joinSelfDescription() }}
                                  </p>
                                </div>
                              </div>
                              <div
                                role="group"
                                data-slot="field"
                                data-orientation="horizontal"
                                [attr.data-matches-spartan-invalid]="choiceError() ? 'true' : null"
                                [class]="fieldHorizontalClass"
                              >
                                <app-checkbox
                                  #addMinorBox
                                  controlId="join-minor"
                                  describedBy="join-minor-description"
                                  [checked]="addMinor()"
                                  (checkedChange)="addMinor.set($event)"
                                  [showInvalid]="choiceError()"
                                />
                                <div data-slot="field-content" [class]="contentClass">
                                  <label
                                    for="join-minor"
                                    data-slot="field-label"
                                    [class]="labelClass"
                                    >Add a minor I’m responsible for</label
                                  >
                                  <p
                                    data-slot="field-description"
                                    id="join-minor-description"
                                    [class]="descriptionClass"
                                  >
                                    For a child who plays. Only their name is stored.
                                  </p>
                                </div>
                              </div>
                            </div>
                            @if (choiceError()) {
                              <div
                                role="alert"
                                data-slot="field-error"
                                id="choices-error"
                                [class]="errorClass"
                              >
                                <ng-icon
                                  name="lucideCircleAlert"
                                  class="mt-0.5 shrink-0 text-base"
                                  aria-hidden="true"
                                />
                                <span
                                  >Choose at least one: join yourself, add a minor, or both.</span
                                >
                              </div>
                            }
                            @if (addMinor()) {
                              <div class="ps-6">
                                <div
                                  role="group"
                                  data-slot="field"
                                  data-orientation="vertical"
                                  [attr.data-matches-spartan-invalid]="
                                    minor.error() ? 'true' : null
                                  "
                                  [attr.data-invalid]="minor.error() ? 'true' : null"
                                  [class]="fieldClass"
                                >
                                  <label
                                    for="minor-name"
                                    data-slot="field-label"
                                    [class]="labelClass"
                                    >Minor’s name</label
                                  >
                                  <input
                                    #minorInput
                                    id="minor-name"
                                    type="text"
                                    data-slot="input"
                                    autocomplete="off"
                                    [formField]="minor.fields.name"
                                    (blur)="minor.left()"
                                    [attr.aria-describedby]="
                                      minor.error()
                                        ? 'minor-name-description minor-name-error'
                                        : 'minor-name-description'
                                    "
                                    [attr.aria-invalid]="minor.error() ? 'true' : null"
                                    [attr.data-invalid]="minor.error() ? 'true' : null"
                                    [attr.data-matches-spartan-invalid]="
                                      minor.error() ? 'true' : null
                                    "
                                    [class]="inputClass"
                                  />
                                  <p
                                    data-slot="field-description"
                                    id="minor-name-description"
                                    [class]="descriptionClass"
                                  >
                                    Up to 60 characters. Players on other teams see their first name
                                    and last initial.
                                  </p>
                                  @if (minor.error(); as error) {
                                    <div
                                      role="alert"
                                      data-slot="field-error"
                                      id="minor-name-error"
                                      [class]="errorClass"
                                    >
                                      <ng-icon
                                        name="lucideCircleAlert"
                                        class="mt-0.5 shrink-0 text-base"
                                        aria-hidden="true"
                                      />
                                      <app-minor-name-error-text [error]="error" />
                                    </div>
                                  }
                                </div>
                              </div>
                            }
                          </fieldset>
                          <button
                            type="submit"
                            appMousePressKeepsFocus
                            data-slot="button"
                            [class]="
                              online()
                                ? primaryButton + ' mt-4 w-full'
                                : primaryButton + ' mt-4 w-full opacity-50'
                            "
                            [attr.aria-disabled]="accepting() || !online() ? 'true' : null"
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
                        </form>
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
  protected readonly fieldSetClass = FIELD_SET;
  protected readonly legendClass = LEGEND;
  protected readonly fieldClass = FIELD;
  protected readonly fieldHorizontalClass = FIELD_HORIZONTAL;
  protected readonly contentClass = FIELD_CONTENT;
  protected readonly labelClass = LABEL;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly inputClass = INPUT;
  protected readonly errorClass = FIELD_ERROR;

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

  /** "Join the roster myself" starts checked, so a player who is not a guardian only presses Accept. */
  protected readonly joinSelf = linkedSignal<string | null, boolean>({
    source: this.token,
    computation: () => true,
  });
  protected readonly addMinor = linkedSignal<string | null, boolean>({
    source: this.token,
    computation: () => false,
  });
  protected readonly selfBlocked = linkedSignal<string | null, SelfBlocked | null>({
    source: this.token,
    computation: () => null,
  });
  protected readonly joinSelfChosen = computed(() => this.joinSelf() && !this.selfBlocked());
  private readonly nothingChosen = computed(() => !this.joinSelfChosen() && !this.addMinor());
  private readonly choiceShown = new ShownUntilValid(
    () => this.nothingChosen(),
    () => false,
  );
  protected readonly choiceError = this.choiceShown.shown;
  protected readonly minor = new MinorNameForm();

  protected readonly joinSelfDescription = computed(() => {
    const blocked = this.selfBlocked();
    if (blocked?.kind === 'otherTeam') {
      return `Not available: you’re on ${blocked.teamName} in this season.`;
    }
    if (blocked?.kind === 'freeAgent') return 'Not available: an organizer places free agents.';
    return 'You play on this team.';
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

  protected readonly joinedHeading = computed(() => {
    const team = this.joined();
    if (!team) return '';
    return !team.joinedSelf && team.minorName
      ? `${team.minorName} is on ${team.teamName}`
      : `You’re on ${team.teamName}`;
  });

  protected readonly joinedLine = computed(() => {
    const team = this.joined();
    if (!team) return '';
    const captain = team.captainName ? ` ${team.captainName} is the captain.` : '';
    if (team.minorName === null) return `You’re on the roster for ${team.seasonName}.${captain}`;
    const who = team.joinedSelf ? `You and ${team.minorName} are` : `${team.minorName} is`;
    return `${who} on the roster for ${team.seasonName}.${captain}`;
  });

  protected readonly refusalText = computed<RefusalText | null>(() => {
    const refusal = this.refusal();
    const teamName = this.summary()?.teamName ?? '';
    const leagueName = this.summary()?.leagueName ?? '';
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
          description: `Each person plays on one team per season, so you can’t join ${teamName} yourself. You can still add a minor you’re responsible for.`,
        };
      case 'waitingFreeAgent':
        return {
          alert: 'info',
          title: 'You’re registered as a free agent in this season.',
          description: `Organizers place free agents on teams. Ask an organizer of ${leagueName} to place you on ${teamName}. You can still add a minor you’re responsible for.`,
        };
      case 'teamFull':
        return {
          alert: 'full',
          title: `${teamName} is full.`,
          description:
            'Nothing was added. If you chose two entries, there may be room for one; otherwise ask the captain whether a place opens.',
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
  private readonly joinSelfBox = viewChild<Checkbox>('joinSelfBox');
  private readonly addMinorBox = viewChild<Checkbox>('addMinorBox');
  private readonly minorInput = viewChild<ElementRef<HTMLInputElement>>('minorInput');
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

  protected async accept(event: Event): Promise<void> {
    event.preventDefault();
    const token = this.token();
    if (this.accepting() || !token) return;
    this.choiceShown.submitted();
    if (this.nothingChosen()) {
      this.focusAfterRender('choices');
      return;
    }
    const joinSelf = this.joinSelfChosen();
    let minorName: string | undefined;
    if (this.addMinor()) {
      const checked = this.minor.check();
      if (checked === null) {
        this.focusAfterRender('minor');
        return;
      }
      minorName = checked;
    }
    // Offline, the button looks disabled but stays focusable: a press explains and sends nothing.
    if (!this.online()) {
      this.refusal.set({ kind: 'offline' });
      this.focusAfterRender('alert');
      return;
    }
    this.refusal.set(null);
    this.accepting.set(true);
    try {
      const result = await this.acceptInvite.run(
        minorName === undefined ? { token, joinSelf } : { token, joinSelf, minorName },
      );
      this.store.clear();
      this.joined.set(result);
      this.focusAfterRender('heading');
    } catch (failure) {
      const refusal = refusalOf(failure);
      if (refusal === 'invalid') {
        this.refusedAsInvalid.set(true);
      } else if (refusal.kind === 'minorName') {
        this.minor.showRefusal(refusal.error);
        this.focusAfterRender('minor');
      } else {
        this.blockSelf(refusal);
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

  private blockSelf(refusal: Refusal): void {
    if (refusal.kind === 'alreadyOnAnotherTeam') {
      this.selfBlocked.set({ kind: 'otherTeam', teamName: refusal.teamName });
    } else if (refusal.kind === 'waitingFreeAgent') {
      this.selfBlocked.set({ kind: 'freeAgent' });
    } else {
      return;
    }
    this.addMinor.set(true);
  }

  private focusAfterRender(target: 'alert' | 'heading' | 'choices' | 'minor'): void {
    afterNextRender(
      () => {
        if (target === 'alert') this.alert()?.focus();
        else if (target === 'heading') this.heading()?.nativeElement.focus();
        else if (target === 'minor') this.minorInput()?.nativeElement.focus();
        else if (this.selfBlocked()) this.addMinorBox()?.focus();
        else this.joinSelfBox()?.focus();
      },
      { injector: this.injector },
    );
  }
}
