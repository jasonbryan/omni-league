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
} from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideEye, lucideEyeOff, lucideWifiOff } from '@ng-icons/lucide';
import { ipLimitTitle } from '../../../convex/lib/ipRateLimit';
import { tooManyAttemptsMessage } from '../../../convex/lib/signInThrottle';
import { AuthService, type SignInResult } from '../core/auth/auth.service';
import { injectContinueToReturnTo } from '../core/auth/continue-to-return-to';
import { returnToOrApp } from '../core/auth/return-to';
import { injectOfflineTitle, injectOnline } from '../core/data/convex';
import { ShownUntilValid } from '../core/forms/shown-errors';
import { PublicLayout } from '../public-layout/public-layout';
import { MousePressKeepsFocus } from '../core/forms/mouse-press-keeps-focus';
import { HlmAlertImports } from '../ui/alert';
import { HlmFieldImports } from '../ui/field';
import { HlmInputImports } from '../ui/input';
import { HlmSpinner } from '../ui/spinner';

/** An email address as Better Auth's server checks it (zod 4 `z.email()`), so the page refuses exactly what the server would. */
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export const MESSAGES = {
  emailEmpty: 'Enter your email address.',
  emailMalformed: 'Enter an email address like name@example.com.',
  passwordEmpty: 'Enter your password.',
  incorrectTitle: 'Email or password is incorrect.',
  incorrectDescription: 'Check both and try again.',
  throttledDescription:
    'Sign-in for this email address is paused after several incorrect passwords.',
  lockedTitle: 'Password sign-in is locked for this email address.',
  lockedDescription:
    'There have been too many incorrect attempts. Contact the Omni League team to unlock it.',
  rateLimitedTitle: ipLimitTitle,
  rateLimitedDescription: 'Several sign-ins came from this network in a short time.',
  unexpectedTitle: 'Sign-in could not be completed.',
  unexpectedDescription: 'Check your connection and try again.',
  offlineDescription: "Your details are still here. Try again when you're connected.",
} as const;

type FieldName = 'email' | 'password';
const FIELDS: readonly FieldName[] = ['email', 'password'];

interface SignInModel {
  email: string;
  password: string;
}

type FormAlert = { title: string; description: string } | 'offline';

// Class strings are the approved mockup's, written as static attributes so Angular sets them before the element is inserted: a `[class]` binding could land after the first style pass, and `transition-all` would then animate it.
// The buttons carry `buttonVariants` output unmerged, as the mockup draws it, so `border-transparent` stays beside `border-border` and the outline button shows no edge.

/** A wrong password and an address with no account get the same alert, with neither field marked invalid, so the page reveals nothing about which addresses exist. */
@Component({
  selector: 'app-sign-in-page',
  imports: [
    HlmSpinner,
    MousePressKeepsFocus,
    FormField,
    HlmAlertImports,
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
        <div
          class="mx-auto w-full max-w-md overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div class="px-5 pt-6 md:px-8 md:pt-8">
            <h1 id="sign-in-heading" class="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p class="mt-2 text-sm text-muted-foreground">
              Pick up where you left off: register for a season, manage your team, or run your
              organization.
            </p>
          </div>
          <form
            novalidate
            aria-labelledby="sign-in-heading"
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
                <div hlmAlertTitle>
                  {{ alert === 'offline' ? offlineTitle() : alert.title }}
                </div>
                <div hlmAlertDescription>
                  {{ alert === 'offline' ? messages.offlineDescription : alert.description }}
                </div>
              </div>
            }
            <div hlmFieldGroup>
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
                    <span>{{ error }}</span>
                  </div>
                }
              </div>
              <div
                hlmField
                [attr.data-matches-spartan-invalid]="errors.password() ? 'true' : null"
                [attr.data-invalid]="errors.password() ? 'true' : null"
              >
                <label hlmFieldLabel for="password">Password</label>
                <div class="flex items-center gap-2">
                  <!-- No maxlength: a long paste is never cut silently (WCAG 3.3.8). -->
                  <input
                    hlmInput
                    #password
                    id="password"
                    autocomplete="current-password"
                    spellcheck="false"
                    autocapitalize="none"
                    [type]="showPassword() ? 'text' : 'password'"
                    [formField]="fields.password"
                    (blur)="left('password')"
                    [attr.aria-describedby]="describedBy('password')"
                    [attr.aria-invalid]="errors.password() ? 'true' : null"
                    [attr.data-invalid]="errors.password() ? 'true' : null"
                    [attr.data-matches-spartan-invalid]="errors.password() ? 'true' : null"
                    class="flex-1"
                  />
                  <!-- The space after the sr-only span (&ngsp;) is kept on purpose: Chrome lays it out as a flex item, so the button gets the approved mockup's width. -->
                  <button
                    type="button"
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
                <hlm-spinner data-icon="inline-start" />Signing in…
              } @else {
                Sign in
              }
            </button>
            <p role="status" class="sr-only">{{ submitting() ? 'Signing in.' : '' }}</p>
          </form>
          <p class="border-t border-border bg-muted/50 px-5 py-4 text-center text-sm md:px-8">
            New to Omni League?
            <a
              routerLink="/sign-up"
              [queryParams]="{ returnTo: signUpReturnTo }"
              class="font-medium text-primary underline underline-offset-4"
              >Create an account</a
            >
          </p>
        </div>
      </div>
    </app-public-layout>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly returnTo = inject(ActivatedRoute).snapshot.queryParamMap.get('returnTo');
  private readonly continueToReturnTo = injectContinueToReturnTo();

  protected readonly signUpReturnTo = returnToOrApp(this.returnTo);

  private readonly model = signal<SignInModel>({ email: '', password: '' });
  protected readonly fields = form(this.model, (path) => {
    required(path.email, { message: MESSAGES.emailEmpty });
    validate(path.email, ({ value }) => {
      const email = value().trim();
      if (email === '') return { kind: 'blank', message: MESSAGES.emailEmpty };
      return EMAIL.test(email) ? undefined : { kind: 'email', message: MESSAGES.emailMalformed };
    });
    // No length check: older passwords are not re-checked against today's policy.
    required(path.password, { message: MESSAGES.passwordEmpty });
  });

  protected readonly messages = MESSAGES;
  protected readonly online = injectOnline();
  protected readonly offlineTitle = injectOfflineTitle();
  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  private readonly clientErrors: Record<FieldName, Signal<string | null>> = {
    email: computed(() => this.fields.email().errors()[0]?.message ?? null),
    password: computed(() => this.fields.password().errors()[0]?.message ?? null),
  };

  private readonly shown: Record<FieldName, ShownUntilValid> = {
    email: this.shownUntilValid('email'),
    password: this.shownUntilValid('password'),
  };

  private readonly serverEmailError = linkedSignal<string, string | null>({
    source: () => this.model().email,
    computation: () => null,
  });

  protected readonly errors: Record<FieldName, Signal<string | null>> = {
    email: computed(() =>
      this.shown.email.shown() ? this.clientErrors.email() : this.serverEmailError(),
    ),
    password: computed(() => (this.shown.password.shown() ? this.clientErrors.password() : null)),
  };

  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('email');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('password');
  private readonly alert = viewChild<ElementRef<HTMLElement>>('alert');

  protected describedBy(field: FieldName): string | null {
    return this.errors[field]() ? `${field}-error` : null;
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

    const { email, password } = this.model();
    this.submitting.set(true);
    const result = await this.auth.signIn({ email: email.trim(), password });
    this.submitting.set(false);
    if (this.continueToReturnTo.underway()) return;
    if (result.ok) {
      await this.continueToReturnTo.go();
      return;
    }
    this.showFailure(result);
  }

  private showFailure(result: Exclude<SignInResult, { ok: true }>): void {
    switch (result.error) {
      case 'invalid-email':
        this.serverEmailError.set(MESSAGES.emailMalformed);
        this.focusAfterRender('email');
        return;
      case 'incorrect':
        this.formAlert.set({
          title: MESSAGES.incorrectTitle,
          description: MESSAGES.incorrectDescription,
        });
        break;
      case 'throttled':
        this.formAlert.set({
          title: tooManyAttemptsMessage(result.retryAfterSeconds),
          description: MESSAGES.throttledDescription,
        });
        break;
      case 'locked':
        this.formAlert.set({
          title: MESSAGES.lockedTitle,
          description: MESSAGES.lockedDescription,
        });
        break;
      case 'rate-limited':
        this.formAlert.set({
          title: MESSAGES.rateLimitedTitle,
          description: MESSAGES.rateLimitedDescription,
        });
        break;
      case 'unexpected':
        this.formAlert.set({
          title: MESSAGES.unexpectedTitle,
          description: MESSAGES.unexpectedDescription,
        });
        break;
    }
    this.focusAfterRender('alert');
  }

  private focusAfterRender(target: FieldName | 'alert'): void {
    afterNextRender(
      () => {
        if (target === 'alert') this.alert()?.nativeElement.focus();
        else if (target === 'email') this.emailInput().nativeElement.focus();
        else this.passwordInput().nativeElement.focus();
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
}
