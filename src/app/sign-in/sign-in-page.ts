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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideEye, lucideEyeOff, lucideLoaderCircle } from '@ng-icons/lucide';
import { tooManyAttemptsMessage } from '../../../convex/lib/signInThrottle';
import { AuthService, type SignInResult } from '../core/auth/auth.service';
import { afterAuthUrl, returnToOrApp } from '../core/auth/return-to';
import { Shell } from '../shell';

/**
 * An email address as Better Auth's server checks it (zod 4 `z.email()`), so the page refuses
 * exactly what the server would. The same pattern as the sign-up page's.
 */
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** Every message on the page (design/mockups/63-sign-in.html, "Messages and attributes"). */
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
  unexpectedTitle: 'Sign-in could not be completed.',
  unexpectedDescription: 'Check your connection and try again.',
} as const;

type FieldName = 'email' | 'password';
const FIELDS: readonly FieldName[] = ['email', 'password'];

interface SignInModel {
  email: string;
  password: string;
}

/** A refusal that is not about one field: the form alert above the fields. */
interface FormAlert {
  title: string;
  description: string;
}

// Every class string below is the approved mockup's (helm Nova, with #61's focus change: no
// halo), written as a static attribute so Angular sets it before the element is inserted: a
// `[class]` binding could land after the first style pass, and `transition-all` would then animate
// it. The buttons carry `buttonVariants` output unmerged, as the mockup draws it, so
// `border-transparent` stays beside `border-border` and the outline button shows no edge;
// sign-in-page.spec.ts checks them. They are the sign-up page's (#62).

/**
 * `/sign-in` (#63), a `RenderMode.Client` route, approved in #96 (design/mockups/63-sign-in.html):
 * email and password with a Show control beside the password. Errors show after a submit, under
 * their field (`aria-invalid`, `aria-describedby`), and each clears once its field is valid; focus
 * goes to the first invalid field, or to the form alert for an answer from the server. A wrong
 * password and an address with no account get the same alert, with neither field marked invalid,
 * so the page reveals nothing about which addresses exist; the entered values stay. After sign-in
 * the browser goes to the validated `returnTo`, else `/app`.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [FormField, NgIcon, RouterLink, Shell],
  providers: [provideIcons({ lucideCircleAlert, lucideEye, lucideEyeOff, lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
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
                data-slot="alert"
                role="alert"
                id="form-error"
                tabindex="-1"
                class="group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90 mb-5"
              >
                <ng-icon name="lucideCircleAlert" aria-hidden="true" />
                <div
                  data-slot="alert-title"
                  class="font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
                >
                  {{ alert.title }}
                </div>
                <div
                  data-slot="alert-description"
                  class="text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
                >
                  {{ alert.description }}
                </div>
              </div>
            }
            <div
              data-slot="field-group"
              class="group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4"
            >
              <div
                role="group"
                data-slot="field"
                data-orientation="vertical"
                [attr.data-matches-spartan-invalid]="errors.email() ? 'true' : null"
                [attr.data-invalid]="errors.email() ? 'true' : null"
                class="group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2"
              >
                <label
                  for="email"
                  data-slot="field-label"
                  class="flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5"
                  >Email</label
                >
                <input
                  #email
                  id="email"
                  type="email"
                  data-slot="input"
                  autocomplete="email"
                  spellcheck="false"
                  autocapitalize="none"
                  [formField]="fields.email"
                  [attr.aria-describedby]="describedBy('email')"
                  [attr.aria-invalid]="errors.email() ? 'true' : null"
                  [attr.data-invalid]="errors.email() ? 'true' : null"
                  [attr.data-matches-spartan-invalid]="errors.email() ? 'true' : null"
                  class="file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 border-input data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-9 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium data-[matches-spartan-invalid=true]:ring-3 md:text-sm"
                />
                @if (errors.email(); as error) {
                  <div
                    role="alert"
                    data-slot="field-error"
                    id="email-error"
                    class="text-destructive text-sm font-normal flex items-start gap-1.5"
                  >
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
                role="group"
                data-slot="field"
                data-orientation="vertical"
                [attr.data-matches-spartan-invalid]="errors.password() ? 'true' : null"
                [attr.data-invalid]="errors.password() ? 'true' : null"
                class="group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2"
              >
                <label
                  for="password"
                  data-slot="field-label"
                  class="flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5"
                  >Password</label
                >
                <div class="flex items-center gap-2">
                  <!-- No maxlength: a long paste is never cut silently (WCAG 3.3.8). -->
                  <input
                    #password
                    id="password"
                    data-slot="input"
                    autocomplete="current-password"
                    spellcheck="false"
                    autocapitalize="none"
                    [type]="showPassword() ? 'text' : 'password'"
                    [formField]="fields.password"
                    [attr.aria-describedby]="describedBy('password')"
                    [attr.aria-invalid]="errors.password() ? 'true' : null"
                    [attr.data-invalid]="errors.password() ? 'true' : null"
                    [attr.data-matches-spartan-invalid]="errors.password() ? 'true' : null"
                    class="file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 border-input data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-9 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium data-[matches-spartan-invalid=true]:ring-3 md:text-sm flex-1"
                  />
                  <!-- The space after the sr-only span (&ngsp;) is kept on purpose: Chrome lays it
                       out as a flex item, so the button gets the approved mockup's width. -->
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
                  <div
                    role="alert"
                    data-slot="field-error"
                    id="password-error"
                    class="text-destructive text-sm font-normal flex items-start gap-1.5"
                  >
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
              data-slot="button"
              class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 mt-6 w-full"
              [attr.aria-disabled]="submitting() ? 'true' : null"
            >
              @if (submitting()) {
                <ng-icon
                  name="lucideLoaderCircle"
                  class="motion-safe:animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />Signing in…
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
    </app-shell>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly returnTo = inject(ActivatedRoute).snapshot.queryParamMap.get('returnTo');

  /** The sign-up page keeps the valid `returnTo`; one that is not valid becomes `/app`. */
  protected readonly signUpReturnTo = returnToOrApp(this.returnTo);

  private readonly model = signal<SignInModel>({ email: '', password: '' });
  protected readonly fields = form(this.model, (path) => {
    required(path.email, { message: MESSAGES.emailEmpty });
    validate(path.email, ({ value }) => {
      const email = value().trim();
      if (email === '') return { kind: 'blank', message: MESSAGES.emailEmpty };
      return EMAIL.test(email) ? undefined : { kind: 'email', message: MESSAGES.emailMalformed };
    });
    // No length check: older passwords are not re-checked against today's policy (ADR 0008).
    required(path.password, { message: MESSAGES.passwordEmpty });
  });

  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  /** The first client-side error of each field, whether or not it is shown. */
  private readonly clientErrors: Record<FieldName, Signal<string | null>> = {
    email: computed(() => this.fields.email().errors()[0]?.message ?? null),
    password: computed(() => this.fields.password().errors()[0]?.message ?? null),
  };

  /** Set on a submit for each invalid field; cleared once the field is valid (mockup state 3). */
  private readonly shown: Record<FieldName, WritableSignal<boolean>> = {
    email: this.shownUntilValid('email'),
    password: this.shownUntilValid('password'),
  };

  /** A server answer about the email field, until its value changes. */
  private readonly serverEmailError = linkedSignal<string, string | null>({
    source: () => this.model().email,
    computation: () => null,
  });

  /** The error each field shows now, or `null`. */
  protected readonly errors: Record<FieldName, Signal<string | null>> = {
    email: computed(() =>
      this.shown.email() ? this.clientErrors.email() : this.serverEmailError(),
    ),
    password: computed(() => (this.shown.password() ? this.clientErrors.password() : null)),
  };

  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('email');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('password');
  private readonly alert = viewChild<ElementRef<HTMLElement>>('alert');

  /** `aria-describedby`: the field's error while one is shown. */
  protected describedBy(field: FieldName): string | null {
    return this.errors[field]() ? `${field}-error` : null;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.formAlert.set(null);
    this.showPassword.set(false);

    let firstInvalid: FieldName | null = null;
    for (const field of FIELDS) {
      const invalid = this.clientErrors[field]() !== null;
      this.shown[field].set(invalid);
      if (invalid) firstInvalid ??= field;
    }
    if (firstInvalid) {
      this.focusAfterRender(firstInvalid);
      return;
    }

    const { email, password } = this.model();
    this.submitting.set(true);
    const result = await this.auth.signIn({ email: email.trim(), password });
    this.submitting.set(false);
    if (result.ok) {
      // replaceUrl: the finished form leaves no history entry, so Back skips it (#207).
      await this.router.navigateByUrl(afterAuthUrl(this.returnTo), { replaceUrl: true });
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

  private shownUntilValid(field: FieldName): WritableSignal<boolean> {
    return linkedSignal<boolean, boolean>({
      source: () => this.clientErrors[field]() === null,
      computation: (valid, previous) => !valid && (previous?.value ?? false),
    });
  }
}
