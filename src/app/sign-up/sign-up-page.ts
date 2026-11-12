import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideEye, lucideEyeOff, lucideWifiOff } from '@ng-icons/lucide';
import { ipLimitTitle } from '../../../convex/lib/ipRateLimit';
import { checkUserName, MAX_USER_NAME_LENGTH } from '../../../convex/lib/userName';
import { AuthService, type SignUpFailure } from '../core/auth/auth.service';
import { injectContinueToReturnTo } from '../core/auth/continue-to-return-to';
import { AFTER_AUTH_DEFAULT, returnToOrApp } from '../core/auth/return-to';
import { injectOfflineTitle, injectOnline } from '../core/data/convex';
import { focusLeftGroup, ShownUntilValid } from '../core/forms/shown-errors';
import { HomeShape } from '../account/home-shape';
import { PublicLayout } from '../public-layout/public-layout';
import { Checkbox } from '../ui/checkbox';
import { MousePressKeepsFocus } from '../core/forms/mouse-press-keeps-focus';
import { HlmAlertImports } from '../ui/alert';
import { HlmCard } from '../ui/card';
import { HlmFieldImports } from '../ui/field';
import { HlmInputImports } from '../ui/input';
import { HlmSpinner } from '../ui/spinner';

// Counted as the server counts (`String.length`), so the page and Better Auth agree on the limits.
export const MIN_PASSWORD = 15;
export const MAX_PASSWORD = 128;

/** An email address as Better Auth's server checks it (zod 4 `z.email()`), so the page refuses exactly what the server would. */
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export const MESSAGES = {
  nameEmpty: 'Enter your name.',
  nameLong: `Use ${MAX_USER_NAME_LENGTH} characters or fewer.`,
  emailEmpty: 'Enter your email address.',
  emailMalformed: 'Enter an email address like name@example.com.',
  passwordEmpty: 'Enter a password.',
  passwordShort: (n: number) => `Use at least ${MIN_PASSWORD} characters. This password has ${n}.`,
  passwordLong: (n: number) => `Use ${MAX_PASSWORD} characters or fewer. This password has ${n}.`,
  adult: 'Confirm that you are 18 or older to create an account.',
  // The link does not wrap (whitespace-nowrap, which the mockup lacks): a link split over two lines has its centre between them, where a pointer or a focus check lands on the text around it.
  exists: 'An account with this email already exists. Sign in instead.',
  breached:
    'This password has appeared in a data breach, so it is not safe to use. Choose a different one.',
  checkUnavailable: 'Failed to check password. Please try again later.',
  rateLimitedTitle: ipLimitTitle,
  rateLimitedDescription:
    'Several sign-ups came from this network in a short time. No account was created.',
  unexpectedTitle: 'Sign-up could not be completed.',
  unexpectedDescription: 'Check your connection and try again.',
  offlineDescription: "Your details are still here. Try again when you're connected.",
} as const;

type FieldName = 'name' | 'email' | 'password' | 'adult';
const FIELDS: readonly FieldName[] = ['name', 'email', 'password', 'adult'];

interface SignUpModel {
  name: string;
  email: string;
  password: string;
  adult: boolean;
}

type FormAlert = 'check-unavailable' | 'rate-limited' | 'unexpected' | 'offline';

// Class strings are the approved mockup's, written as static attributes so Angular sets them before the element is inserted: a `[class]` binding could land after the first style pass, and `transition-all` would then animate it.
// The buttons carry `buttonVariants` output unmerged, as the mockup draws it, so `border-transparent` stays beside `border-border` and the outline button shows no edge.

@Component({
  selector: 'app-sign-up-page',
  imports: [
    HlmSpinner,
    MousePressKeepsFocus,
    Checkbox,
    FormField,
    HlmAlertImports,
    HlmCard,
    HlmFieldImports,
    HlmInputImports,
    NgIcon,
    RouterLink,
    PublicLayout,
  ],
  providers: [provideIcons({ lucideCircleAlert, lucideEye, lucideEyeOff, lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
        <div hlmCard size="bare" class="mx-auto w-full max-w-md overflow-hidden">
          <div class="px-5 pt-6 md:px-8 md:pt-8">
            <h1 id="sign-up-heading" class="text-2xl font-semibold tracking-tight">
              Create your account
            </h1>
            <p class="mt-2 text-sm text-muted-foreground">
              Register for seasons, accept team invites, and run your organization.
            </p>
          </div>
          <form
            novalidate
            aria-labelledby="sign-up-heading"
            class="px-5 pt-5 pb-6 md:px-8 md:pb-8"
            (submit)="submit($event)"
          >
            @if (formAlert(); as alert) {
              <div
                #alert
                hlmAlert
                variant="destructive"
                role="alert"
                id="form-error"
                tabindex="-1"
                class="mb-5"
              >
                <ng-icon
                  [name]="alert === 'offline' ? 'lucideWifiOff' : 'lucideCircleAlert'"
                  aria-hidden="true"
                />
                @if (alert === 'check-unavailable') {
                  <div hlmAlertTitle>
                    {{ messages.checkUnavailable }}
                  </div>
                } @else if (alert === 'offline') {
                  <div hlmAlertTitle>
                    {{ offlineTitle() }}
                  </div>
                  <div hlmAlertDescription>
                    {{ messages.offlineDescription }}
                  </div>
                } @else if (alert === 'rate-limited') {
                  <div hlmAlertTitle>
                    {{ messages.rateLimitedTitle }}
                  </div>
                  <div hlmAlertDescription>
                    {{ messages.rateLimitedDescription }}
                  </div>
                } @else {
                  <div hlmAlertTitle>
                    {{ messages.unexpectedTitle }}
                  </div>
                  <div hlmAlertDescription>
                    {{ messages.unexpectedDescription }}
                  </div>
                }
              </div>
            }
            <p class="text-sm text-muted-foreground">All fields are required.</p>
            <div hlmFieldGroup class="mt-4">
              <div
                hlmField
                [attr.data-matches-spartan-invalid]="errors.name() ? 'true' : null"
                [attr.data-invalid]="errors.name() ? 'true' : null"
              >
                <label hlmFieldLabel for="name">Name</label>
                <input
                  hlmInput
                  #name
                  id="name"
                  type="text"
                  autocomplete="name"
                  autocapitalize="words"
                  [formField]="fields.name"
                  (blur)="left('name')"
                  [attr.aria-describedby]="describedBy('name', 'name-description')"
                  [attr.aria-invalid]="errors.name() ? 'true' : null"
                  [attr.data-invalid]="errors.name() ? 'true' : null"
                  [attr.data-matches-spartan-invalid]="errors.name() ? 'true' : null"
                />
                <p hlmFieldDescription id="name-description">
                  Shown to your teammates and organizers.
                </p>
                @if (errors.name(); as error) {
                  <div hlmFieldError id="name-error">
                    <ng-icon
                      name="lucideCircleAlert"
                      class="mt-0.5 shrink-0 text-base"
                      aria-hidden="true"
                    />
                    <span>{{ error }}</span>
                  </div>
                }
              </div>
              <div
                hlmField
                [attr.data-matches-spartan-invalid]="errors.email() ? 'true' : null"
                [attr.data-invalid]="errors.email() ? 'true' : null"
              >
                <label hlmFieldLabel for="email">Email</label>
                <input
                  hlmInput
                  #email
                  id="email"
                  type="email"
                  autocomplete="email"
                  spellcheck="false"
                  autocapitalize="none"
                  [formField]="fields.email"
                  (blur)="left('email')"
                  [attr.aria-describedby]="describedBy('email')"
                  [attr.aria-invalid]="errors.email() ? 'true' : null"
                  [attr.data-invalid]="errors.email() ? 'true' : null"
                  [attr.data-matches-spartan-invalid]="errors.email() ? 'true' : null"
                />
                @if (errors.email(); as error) {
                  <div hlmFieldError id="email-error">
                    <ng-icon
                      name="lucideCircleAlert"
                      class="mt-0.5 shrink-0 text-base"
                      aria-hidden="true"
                    />
                    <span>
                      @if (error === messages.exists) {
                        An account with this email already exists.
                        <a
                          routerLink="/sign-in"
                          [queryParams]="{ returnTo: signInReturnTo }"
                          class="font-medium whitespace-nowrap underline underline-offset-4"
                          >Sign in instead</a
                        >.
                      } @else {
                        {{ error }}
                      }
                    </span>
                  </div>
                }
              </div>
              <div
                hlmField
                [attr.data-matches-spartan-invalid]="errors.password() ? 'true' : null"
                [attr.data-invalid]="errors.password() ? 'true' : null"
              >
                <label hlmFieldLabel for="password">Password</label>
                <!-- Password and Show are one group: the check waits until focus leaves both, so tabbing or clicking to Show does not talk over its status. -->
                <div
                  class="flex items-center gap-2"
                  (focusout)="focusLeftGroup($event) && left('password')"
                >
                  <!-- No maxlength: a long paste is never cut silently (WCAG 3.3.8). -->
                  <input
                    hlmInput
                    #password
                    id="password"
                    autocomplete="new-password"
                    spellcheck="false"
                    autocapitalize="none"
                    [type]="showPassword() ? 'text' : 'password'"
                    [formField]="fields.password"
                    [attr.aria-describedby]="describedBy('password', 'password-description')"
                    [attr.aria-invalid]="errors.password() ? 'true' : null"
                    [attr.data-invalid]="errors.password() ? 'true' : null"
                    [attr.data-matches-spartan-invalid]="errors.password() ? 'true' : null"
                    class="flex-1"
                  />
                  <!-- The space after the sr-only span (&ngsp;) is kept on purpose: Chrome lays it out as a flex item, so the button gets the approved mockup's width. -->
                  <button
                    type="button"
                    appMousePressKeepsFocus
                    appTouchKeepsFocus
                    data-slot="button"
                    aria-controls="password"
                    class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3"
                    (click)="showPassword.set(!showPassword())"
                  >
                    @if (showPassword()) {
                      <ng-icon
                        name="lucideEyeOff"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />Hide<span class="sr-only"> password</span>&ngsp;
                    } @else {
                      <ng-icon
                        name="lucideEye"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />Show<span class="sr-only"> password</span>&ngsp;
                    }
                  </button>
                </div>
                <p hlmFieldDescription id="password-description">
                  At least 15 characters; a phrase of several words works.
                </p>
                @if (errors.password(); as error) {
                  <div hlmFieldError id="password-error">
                    <ng-icon
                      name="lucideCircleAlert"
                      class="mt-0.5 shrink-0 text-base"
                      aria-hidden="true"
                    />
                    <span>{{ error }}</span>
                  </div>
                }
                <p role="status" class="sr-only">
                  {{ showPassword() ? 'Your password is shown.' : '' }}
                </p>
              </div>
              <div
                hlmField
                orientation="horizontal"
                [attr.data-matches-spartan-invalid]="errors.adult() ? 'true' : null"
                [attr.data-invalid]="errors.adult() ? 'true' : null"
              >
                <app-checkbox
                  #adult
                  controlId="adult"
                  [formField]="fields.adult"
                  (touch)="left('adult')"
                  [describedBy]="describedBy('adult', 'adult-description')"
                  [showInvalid]="!!errors.adult()"
                />
                <div hlmFieldContent>
                  <label hlmFieldLabel for="adult">I am 18 or older</label>
                  <p hlmFieldDescription id="adult-description">
                    Accounts are for adults. A parent, guardian, or organizer adds players under 18
                    to a roster.
                  </p>
                  @if (errors.adult(); as error) {
                    <div hlmFieldError id="adult-error">
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
            </div>
            <button
              type="submit"
              appMousePressKeepsFocus
              data-slot="button"
              class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 mt-6 w-full"
              [class.opacity-50]="!online() && !submitting()"
              [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
            >
              @if (submitting()) {
                <hlm-spinner data-icon="inline-start" />Creating account…
              } @else {
                Create account
              }
            </button>
            <p role="status" class="sr-only">{{ submitting() ? 'Creating your account.' : '' }}</p>
          </form>
          <p class="border-t border-border bg-muted/50 px-5 py-4 text-center text-sm md:px-8">
            Already have an account?
            <a
              routerLink="/sign-in"
              [queryParams]="{ returnTo: signInReturnTo }"
              class="font-medium text-primary underline underline-offset-4"
              >Sign in</a
            >
          </p>
        </div>
      </div>
    </app-public-layout>
  `,
})
export class SignUpPage {
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly returnTo = inject(ActivatedRoute).snapshot.queryParamMap.get('returnTo');
  private readonly continueToReturnTo = injectContinueToReturnTo();
  private readonly homeShape = inject(HomeShape);

  protected readonly signInReturnTo = returnToOrApp(this.returnTo);

  protected readonly messages = MESSAGES;
  protected readonly focusLeftGroup = focusLeftGroup;

  private readonly model = signal<SignUpModel>({ name: '', email: '', password: '', adult: false });
  protected readonly fields = form(this.model, (path) => {
    required(path.name, { message: MESSAGES.nameEmpty });
    validate(path.name, ({ value }) => {
      const check = checkUserName(value());
      if (check.ok) return undefined;
      return check.code === 'empty'
        ? { kind: 'blank', message: MESSAGES.nameEmpty }
        : { kind: 'long', message: MESSAGES.nameLong };
    });
    required(path.email, { message: MESSAGES.emailEmpty });
    validate(path.email, ({ value }) => {
      const email = value().trim();
      if (email === '') return { kind: 'blank', message: MESSAGES.emailEmpty };
      return EMAIL.test(email) ? undefined : { kind: 'email', message: MESSAGES.emailMalformed };
    });
    required(path.password, { message: MESSAGES.passwordEmpty });
    validate(path.password, ({ value }) => {
      const length = value().length;
      if (length === 0) return undefined;
      if (length < MIN_PASSWORD) return { kind: 'short', message: MESSAGES.passwordShort(length) };
      if (length > MAX_PASSWORD) return { kind: 'long', message: MESSAGES.passwordLong(length) };
      return undefined;
    });
    required(path.adult, { message: MESSAGES.adult });
  });

  protected readonly online = injectOnline();
  protected readonly offlineTitle = injectOfflineTitle();
  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  private readonly clientErrors: Record<FieldName, Signal<string | null>> = {
    name: computed(() => this.fields.name().errors()[0]?.message ?? null),
    email: computed(() => this.fields.email().errors()[0]?.message ?? null),
    password: computed(() => this.fields.password().errors()[0]?.message ?? null),
    adult: computed(() => this.fields.adult().errors()[0]?.message ?? null),
  };

  private readonly shown: Record<FieldName, ShownUntilValid> = {
    name: this.shownUntilValid('name'),
    email: this.shownUntilValid('email'),
    password: this.shownUntilValid('password'),
    adult: this.shownUntilValid('adult'),
  };

  private readonly serverErrors: Record<FieldName, WritableSignal<string | null>> = {
    name: this.untilChanged(() => this.model().name),
    email: this.untilChanged(() => this.model().email),
    password: this.untilChanged(() => this.model().password),
    adult: this.untilChanged(() => this.model().adult),
  };

  protected readonly errors: Record<FieldName, Signal<string | null>> = {
    name: this.shownError('name'),
    email: this.shownError('email'),
    password: this.shownError('password'),
    adult: this.shownError('adult'),
  };

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('email');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('password');
  private readonly adultCheckbox = viewChild.required(Checkbox);
  private readonly alert = viewChild<ElementRef<HTMLElement>>('alert');

  protected describedBy(field: FieldName, description?: string): string | null {
    const ids = [description, this.errors[field]() ? `${field}-error` : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : null;
  }

  protected left(field: FieldName): void {
    this.shown[field].left();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.formAlert.set(null);
    this.showPassword.set(false);

    let firstInvalid: FieldName | null = null;
    for (const field of FIELDS) {
      this.shown[field].submitted();
      if (this.clientErrors[field]() !== null) firstInvalid ??= field;
    }
    if (firstInvalid) {
      this.focusAfterRender(firstInvalid);
      return;
    }

    if (!this.online()) {
      this.formAlert.set('offline');
      this.focusAfterRender('alert');
      return;
    }

    const { name, email, password } = this.model();
    this.submitting.set(true);
    const result = await this.auth.signUp({ name: name.trim(), email: email.trim(), password });
    this.submitting.set(false);
    if (this.continueToReturnTo.underway()) return;
    if (result.ok) {
      // A sign-up that goes on to a registration page leaves an account that is no longer new when it opens the home.
      if (returnToOrApp(this.returnTo) === AFTER_AUTH_DEFAULT) this.homeShape.record('new');
      await this.continueToReturnTo.go();
      return;
    }
    this.showFailure(result.error, password.length);
  }

  private showFailure(failure: SignUpFailure, passwordLength: number): void {
    const onField: Partial<Record<SignUpFailure, [FieldName, string]>> = {
      exists: ['email', MESSAGES.exists],
      'invalid-email': ['email', MESSAGES.emailMalformed],
      breached: ['password', MESSAGES.breached],
      'password-too-short': ['password', MESSAGES.passwordShort(passwordLength)],
      'password-too-long': ['password', MESSAGES.passwordLong(passwordLength)],
      'adult-required': ['adult', MESSAGES.adult],
      'name-invalid': ['name', MESSAGES.nameLong],
    };
    const fieldError = onField[failure];
    if (fieldError) {
      const [field, message] = fieldError;
      this.serverErrors[field].set(message);
      this.focusAfterRender(field);
      return;
    }
    this.formAlert.set(
      failure === 'check-unavailable' || failure === 'rate-limited' ? failure : 'unexpected',
    );
    this.focusAfterRender('alert');
  }

  private focusAfterRender(target: FieldName | 'alert'): void {
    const inputs = { name: this.nameInput, email: this.emailInput, password: this.passwordInput };
    afterNextRender(
      () => {
        if (target === 'alert') this.alert()?.nativeElement.focus();
        else if (target === 'adult') this.adultCheckbox().focus();
        else inputs[target]().nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  private shownUntilValid(field: FieldName): ShownUntilValid {
    return new ShownUntilValid(
      () => this.clientErrors[field]() !== null,
      () => this.fields[field]().dirty(),
    );
  }

  private untilChanged(value: () => unknown): WritableSignal<string | null> {
    return linkedSignal<unknown, string | null>({ source: value, computation: () => null });
  }

  private shownError(field: FieldName): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown() ? this.clientErrors[field]() : this.serverErrors[field](),
    );
  }
}
