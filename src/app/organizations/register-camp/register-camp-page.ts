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
  lucideCalendarX,
  lucideCircleAlert,
  lucideCircleCheck,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { combineLatest, map } from 'rxjs';
import {
  SELF_PARTICIPANT,
  ageConfirmationLabel,
  ageNotConfirmedMessage,
  childNameError,
  type Participant,
} from '../../../../convex/lib/individualRegistration';
import { AuthService } from '../../core/auth/auth.service';
import { SIGN_IN_PATH } from '../../core/auth/guards';
import {
  api,
  ConvexOfflineError,
  injectMutation,
  injectOnline,
  injectQuery,
  skipToken,
} from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { injectNow } from '../../core/now';
import { NotFoundView } from '../../not-found/not-found-view';
import { ServerErrorView } from '../../server-error/server-error-view';
import { Shell } from '../../shell';
import { MinorNameErrorText } from '../../teams/minor-name-error-text';
import { MinorNameForm } from '../../teams/minor-name-form';
import { RegisterSkeleton } from '../../teams/register-card';
import { HlmAlertImports } from '../../ui/alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../../ui/button/button-classes';
import { Checkbox } from '../../ui/checkbox';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmRadioGroupImports } from '../../ui/radio-group';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import { StickyFooter, STICKY_FOOTER_CLEARANCE } from '../admin/sticky-footer';
import { StickyFooterFocus } from '../admin/sticky-footer-focus';
import { publicCampPath } from '../public-camp/public-camp-path';
import { RegisterCampCard } from './register-camp-card';
import { registerCampPath } from './register-camp-path';
import {
  campClosedLine,
  registerCampState,
  registrationOptions,
  type RegisterCampState,
} from './register-camp-state';

export const REGISTER_CAMP_MESSAGES = {
  failedTitle: 'You could not be registered.',
  failedDescription: 'No place was taken. Check your connection and try again.',
  offlineDescription: "Your answers are still here. Try again when you're connected.",
  noSessionTitle: 'This session was not found.',
  noSessionDescription:
    'It may have been removed, or the link is incomplete. Choose a session on the camp page.',
  registeredTitle: (session: string) => `You're registered for ${session}.`,
  registeredDescription: 'Your place is held. You’ll find it on the camp page.',
  closedTitle: 'Registration for this session is closed.',
  fullTitle: 'This session is full.',
  fullDescription: 'Every place is taken. Choose another session on the camp page.',
  adultNotAllowedTitle: (minimumAge: number, maximumAge: number) =>
    `This camp is for ages ${minimumAge} to ${maximumAge}.`,
  adultNotAllowedDescription: 'An adult cannot register themself for it.',
  minorNotAllowedTitle: (minimumAge: number) => `This camp is for ages ${minimumAge} and over.`,
  minorNotAllowedDescription: 'A child cannot be registered for it.',
  childNameDescription: 'Only the name is stored. It is never shown on public pages.',
} as const;

type Attending = 'self' | 'minor';

const ATTENDING_LABELS: Readonly<Record<Attending, string>> = { self: 'Me', minor: 'My child' };

/** What the page shows after a refused submit, before the query catches up. */
type Refusal =
  'closed' | 'full' | 'registered' | 'adult-not-allowed' | 'minor-not-allowed' | 'no-session';

type FormAlert = 'offline' | 'failed';

type NoticeState = Exclude<RegisterCampState, 'loading' | 'not-found' | 'signed-out' | 'form'>;

interface Notice {
  icon: string;
  title: string;
  description: string;
}

const REFUSAL_CODES: Readonly<Record<string, Refusal>> = {
  registrationClosed: 'closed',
  sessionFull: 'full',
  alreadyRegistered: 'registered',
  adultNotAllowed: 'adult-not-allowed',
  minorNotAllowed: 'minor-not-allowed',
  campNotFound: 'no-session',
};

function refusalData(failure: unknown): Record<string, unknown> | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
}

@Component({
  selector: 'app-register-camp-page',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    Checkbox,
    FormField,
    HlmAlertImports,
    HlmFieldImports,
    HlmFieldSetImports,
    HlmInputImports,
    HlmRadioGroupImports,
    HlmSpinner,
    MinorNameErrorText,
    NgIcon,
    NotFoundView,
    RegisterCampCard,
    RegisterSkeleton,
    RouterLink,
    ServerErrorView,
    Shell,
    StickyFooter,
    StickyFooterFocus,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideCalendarX,
      lucideCircleAlert,
      lucideCircleCheck,
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
          <app-register-skeleton subject="camp session" />
        }
        @default {
          @if (camp(); as camp) {
            <app-register-camp-card [camp]="camp" [campHref]="campHref()">
              @if (notice(); as notice) {
                <div class="px-4 pt-5 pb-6 md:px-8 md:pb-8">
                  <div
                    #cardAlert
                    hlmAlert
                    [attr.role]="refused() ? 'alert' : 'status'"
                    tabindex="-1"
                    class="outline-offset-2 focus:outline-2 focus:outline-ring"
                  >
                    <ng-icon [name]="notice.icon" aria-hidden="true" />
                    <div hlmAlertTitle>{{ notice.title }}</div>
                    <div hlmAlertDescription>{{ notice.description }}</div>
                  </div>
                  <a
                    [routerLink]="campHref()"
                    data-slot="button"
                    [class]="outlineButton + ' mt-4 w-full'"
                    ><ng-icon
                      name="lucideArrowLeft"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Back to the camp page</a
                  >
                </div>
              } @else if (session(); as session) {
                <form
                  appStickyFooterFocus
                  novalidate
                  aria-labelledby="register-heading"
                  class="px-4 pt-5 pb-4 md:px-8 md:pb-8"
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
                  <div hlmFieldGroup [class]="clearanceClass">
                    <fieldset hlmFieldSet id="participant">
                      <legend hlmFieldLegend id="participant-legend" variant="label">
                        Who's attending
                      </legend>
                      <hlm-radio-group
                        name="participant"
                        aria-labelledby="participant-legend"
                        [value]="attending()"
                        (valueChange)="choose($event)"
                      >
                        @for (option of options(); track option) {
                          <div hlmField orientation="horizontal">
                            <hlm-radio [inputId]="'participant-' + option" [value]="option">
                              <hlm-radio-indicator />
                            </hlm-radio>
                            <div hlmFieldContent>
                              <label hlmFieldLabel [for]="'participant-' + option">{{
                                attendingLabels[option]
                              }}</label>
                            </div>
                          </div>
                        }
                      </hlm-radio-group>
                    </fieldset>
                    @if (attending() === 'minor') {
                      <div
                        hlmField
                        [attr.data-matches-spartan-invalid]="child.error() ? 'true' : null"
                        [attr.data-invalid]="child.error() ? 'true' : null"
                      >
                        <label hlmFieldLabel for="minor-name">Child's name</label>
                        <input
                          hlmInput
                          #nameInput
                          id="minor-name"
                          type="text"
                          autocomplete="off"
                          [formField]="child.fields.name"
                          (blur)="child.left()"
                          [attr.aria-describedby]="
                            child.error()
                              ? 'minor-name-description minor-name-error'
                              : 'minor-name-description'
                          "
                          [attr.aria-invalid]="child.error() ? 'true' : null"
                          [attr.data-invalid]="child.error() ? 'true' : null"
                          [attr.data-matches-spartan-invalid]="child.error() ? 'true' : null"
                        />
                        <p hlmFieldDescription id="minor-name-description">
                          {{ messages.childNameDescription }}
                        </p>
                        @if (child.error(); as nameError) {
                          <div hlmFieldError id="minor-name-error">
                            <ng-icon
                              name="lucideCircleAlert"
                              class="mt-0.5 shrink-0 text-base"
                              aria-hidden="true"
                            />
                            <span class="min-w-0 break-words"
                              ><app-minor-name-error-text [error]="nameError"
                            /></span>
                          </div>
                        }
                      </div>
                    }
                    <div
                      hlmField
                      orientation="horizontal"
                      [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
                      [attr.data-invalid]="error() ? 'true' : null"
                    >
                      <app-checkbox
                        controlId="age-confirmed"
                        [formField]="fields.ageConfirmed"
                        (touch)="shown.left()"
                        [describedBy]="error() ? 'age-confirmed-error' : null"
                        [showInvalid]="!!error()"
                      />
                      <div hlmFieldContent class="min-w-0">
                        <label hlmFieldLabel for="age-confirmed" class="break-words">{{
                          ageLabel()
                        }}</label>
                        @if (error(); as error) {
                          <div hlmFieldError id="age-confirmed-error">
                            <ng-icon
                              name="lucideCircleAlert"
                              class="mt-0.5 shrink-0 text-base"
                              aria-hidden="true"
                            />
                            <span class="min-w-0 break-words">{{ error }}</span>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                  <div appStickyFooter>
                    <button
                      type="submit"
                      data-slot="button"
                      [class]="primaryButton + ' w-full'"
                      [class.opacity-50]="!online() && !submitting()"
                      [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
                    >
                      @if (submitting()) {
                        <hlm-spinner data-icon="inline-start" />Registering…
                      } @else {
                        Register
                      }
                    </button>
                  </div>
                  <p role="status" class="sr-only">
                    {{ submitting() ? 'Registering for ' + session.name + '.' : '' }}
                  </p>
                </form>
              }
            </app-register-camp-card>
          }
        }
      }
    </app-shell>
  `,
})
export class RegisterCampPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly title = inject(Title);
  private readonly register = injectMutation(api.campRegistrations.register);

  protected readonly messages = REGISTER_CAMP_MESSAGES;
  protected readonly attendingLabels = ATTENDING_LABELS;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly online = injectOnline();
  private readonly now = injectNow();

  private readonly route = toSignal(
    combineLatest([inject(ActivatedRoute).paramMap, inject(ActivatedRoute).queryParamMap]).pipe(
      map(([params, query]) => ({
        orgSlug: params.get('orgSlug') ?? '',
        campSlug: params.get('campSlug') ?? '',
        sessionId: query.get('session') ?? undefined,
      })),
    ),
    { requireSync: true },
  );

  protected readonly path = computed(() => {
    const { orgSlug, campSlug, sessionId } = this.route();
    return registerCampPath(orgSlug, campSlug, sessionId);
  });
  protected readonly campHref = computed(() => {
    const { orgSlug, campSlug } = this.route();
    return publicCampPath(orgSlug, campSlug);
  });

  private readonly sessionKnown = signal(false);

  // Asked signed out as well, so an unknown camp shows the not-found view before any sign-in. Signed in, it waits until Convex has
  // accepted the token, so its first answer says whether the caller holds a place.
  private readonly registration = injectQuery(api.campRegistrations.getForRegistration, () => {
    if (!this.sessionKnown()) return skipToken;
    if (this.auth.signedIn() && !this.auth.convexAuthenticated()) return skipToken;
    const { sessionId, ...slugs } = this.route();
    return sessionId === undefined ? slugs : { ...slugs, sessionId };
  });

  protected readonly camp = computed(() => this.registration.value() ?? null);
  protected readonly session = computed(() => this.camp()?.session ?? null);

  private readonly refusal = linkedSignal<unknown, Refusal | null>({
    source: this.route,
    computation: () => null,
  });
  protected readonly refused = computed(() => this.refusal() !== null);

  private readonly firstState = computed(() =>
    registerCampState({
      answer: this.sessionKnown() ? this.registration.value() : undefined,
      signedIn: this.auth.signedIn(),
      nowMs: this.now(),
    }),
  );

  /** Signed out, the page stays on its skeleton while it sends the visitor to sign in. */
  protected readonly state = computed<RegisterCampState | 'error'>(() => {
    if (this.registration.error()) return 'error';
    const state = this.firstState();
    if (state === 'signed-out') return 'loading';
    const refusal = this.refusal();
    return state === 'form' && refusal !== null ? refusal : state;
  });

  protected readonly notice = computed<Notice | null>(() => {
    const state = this.state();
    const camp = this.camp();
    const session = this.session();
    if (!camp) return null;
    const messages = REGISTER_CAMP_MESSAGES;
    const byState: Record<NoticeState, () => Notice> = {
      'no-session': () => ({
        icon: 'lucideCircleAlert',
        title: messages.noSessionTitle,
        description: messages.noSessionDescription,
      }),
      registered: () => ({
        icon: 'lucideCircleCheck',
        title: messages.registeredTitle(session?.name ?? ''),
        description: messages.registeredDescription,
      }),
      'adult-not-allowed': () => ({
        icon: 'lucideUsers',
        title: messages.adultNotAllowedTitle(camp.minimumAge, camp.maximumAge),
        description: messages.adultNotAllowedDescription,
      }),
      'minor-not-allowed': () => ({
        icon: 'lucideUsers',
        title: messages.minorNotAllowedTitle(camp.minimumAge),
        description: messages.minorNotAllowedDescription,
      }),
      closed: () => ({
        icon: 'lucideCalendarX',
        title: messages.closedTitle,
        description: session ? campClosedLine(session) : '',
      }),
      full: () => ({
        icon: 'lucideUsers',
        title: messages.fullTitle,
        description: messages.fullDescription,
      }),
    };
    return state in byState ? byState[state as NoticeState]() : null;
  });

  protected readonly options = computed<Attending[]>(() => {
    const camp = this.camp();
    return camp ? registrationOptions(camp) : [];
  });
  private readonly chosen = signal<Attending | null>(null);
  /** The first offered option until the guardian chooses, so a camp with one option needs no choice. */
  protected readonly attending = computed<Attending>(() => {
    const chosen = this.chosen();
    const options = this.options();
    return chosen !== null && options.includes(chosen) ? chosen : (options[0] ?? 'self');
  });
  protected readonly child = new MinorNameForm('', childNameError);
  private readonly participant = computed<Participant>(() =>
    this.attending() === 'self'
      ? SELF_PARTICIPANT
      : { kind: 'minor', minorName: this.child.model().name },
  );

  protected readonly ageLabel = computed(() => {
    const camp = this.camp();
    const session = this.session();
    return camp && session
      ? ageConfirmationLabel(
          this.participant(),
          camp.minimumAge,
          camp.maximumAge,
          session.startDate,
        )
      : '';
  });

  private readonly model = signal({ ageConfirmed: false });
  protected readonly fields = form(this.model, (path) => {
    required(path.ageConfirmed);
  });
  private readonly clientError = computed(() =>
    this.fields.ageConfirmed().errors().length > 0
      ? ageNotConfirmedMessage(this.participant())
      : null,
  );
  protected readonly shown = new ShownUntilValid(
    () => this.clientError() !== null,
    () => this.fields.ageConfirmed().dirty(),
  );
  private readonly serverError = linkedSignal<boolean, string | null>({
    source: () => this.model().ageConfirmed,
    computation: () => null,
  });
  protected readonly error = computed(() =>
    this.shown.shown() ? this.clientError() : this.serverError(),
  );

  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  private readonly ageBox = viewChild(Checkbox);
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
      const camp = this.camp();
      const session = this.session();
      if (camp && session) {
        this.title.setTitle(`Register for ${session.name} | ${camp.name} | Omni League`);
      }
    });
    effect(() => {
      const alert = this.cardAlert();
      if (!this.focusCardAlert() || !alert) return;
      alert.nativeElement.focus();
      this.focusCardAlert.set(false);
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const session = this.session();
    if (this.submitting() || !session) return;
    this.formAlert.set(null);
    const participant = this.participant();
    const minorName = participant.kind === 'minor' ? this.child.check() : null;
    const invalidAge = this.clientError() !== null;
    this.shown.submitted();
    if (participant.kind === 'minor' && minorName === null) {
      this.focusNameAfterRender();
      return;
    }
    if (invalidAge) {
      this.focusAgeBoxAfterRender();
      return;
    }
    if (!this.online()) {
      this.showAlert('offline');
      return;
    }
    this.submitting.set(true);
    try {
      await this.register.run({
        sessionId: session.sessionId,
        participant: minorName === null ? participant : { kind: 'minor', minorName },
        ageConfirmed: this.model().ageConfirmed,
      });
    } catch (failure) {
      this.submitting.set(false);
      this.showFailure(failure);
      return;
    }
    // A finished one-time form is replaced in history, so Back returns to where the visitor came from.
    await this.router.navigateByUrl(this.campHref(), { replaceUrl: true });
    this.submitting.set(false);
  }

  protected choose(kind: string): void {
    if (kind !== 'self' && kind !== 'minor') return;
    this.chosen.set(kind);
    // The ticked box confirmed the other participant's statement.
    this.model.set({ ageConfirmed: false });
    this.fields().reset();
  }

  private showFailure(failure: unknown): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const data = refusalData(failure);
    if (data?.['field'] === 'ageConfirmed' && typeof data['message'] === 'string') {
      this.serverError.set(data['message']);
      this.focusAgeBoxAfterRender();
      return;
    }
    if (data?.['field'] === 'minorName' && typeof data['message'] === 'string') {
      this.child.showRefusal({ kind: 'text', text: data['message'] });
      this.focusNameAfterRender();
      return;
    }
    const code = data?.['code'];
    const refusal = typeof code === 'string' ? REFUSAL_CODES[code] : undefined;
    if (refusal) {
      this.refusal.set(refusal);
      this.focusCardAlert.set(true);
      return;
    }
    this.showAlert('failed');
  }

  private showAlert(alert: FormAlert): void {
    this.formAlert.set(alert);
    afterNextRender(() => this.formAlertBox()?.focus(), { injector: this.injector });
  }

  private focusNameAfterRender(): void {
    afterNextRender(() => this.nameInput()?.nativeElement.focus(), { injector: this.injector });
  }

  private focusAgeBoxAfterRender(): void {
    afterNextRender(() => this.ageBox()?.focus(), { injector: this.injector });
  }
}
