import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { MESSAGES, SignInPage } from './sign-in-page';

@Component({ template: 'elsewhere' })
class Elsewhere {}

const EMAIL = 'maya.okafor@example.com';
const PASSWORD = 'sandbar sunset spike 2026';

describe('SignInPage', () => {
  let client: FakeAuthClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open(url = '/sign-in') {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(client),
        provideRouter([
          { path: 'sign-in', component: SignInPage },
          { path: 'sign-up', component: Elsewhere },
          { path: 'app', component: Elsewhere },
          { path: 'leagues/x/register', component: Elsewhere },
          { path: '', component: Elsewhere },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    client.emitSession(null);
    page = harness.routeNativeElement!;
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const submitButton = () => page.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const showButton = () =>
    page.querySelector<HTMLButtonElement>('button[aria-controls="password"]')!;
  const error = (id: string) => page.querySelector(`#${id}-error`)?.textContent?.trim() ?? null;
  const alert = () => page.querySelector<HTMLElement>('#form-error');
  const alertTitle = () =>
    alert()?.querySelector('[data-slot="alert-title"]')?.textContent?.trim() ?? null;
  const alertDescription = () =>
    alert()?.querySelector('[data-slot="alert-description"]')?.textContent?.trim() ?? null;
  const url = () => TestBed.inject(Router).url;
  const createAccount = () => page.querySelector<HTMLAnchorElement>('main form ~ p a');

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function fill({ email = EMAIL, password = PASSWORD } = {}) {
    await type('email', email);
    await type('password', password);
  }

  async function submit() {
    submitButton().click();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  }

  it('renders in the public layout: top bar and footer, no sidebar', async () => {
    await open();
    expect(page.firstElementChild?.tagName).toBe('APP-PUBLIC-LAYOUT');
    expect(page.querySelectorAll('header')).toHaveLength(1);
    expect(page.querySelectorAll('footer')).toHaveLength(1);
    expect(page.querySelector('main#main')).not.toBeNull();
    expect(page.querySelector('button[aria-label="Open navigation"]')).toBeNull();
  });

  describe('fields (mockup "Sign-in field attributes")', () => {
    beforeEach(() => open());

    it('has the heading, the intro, and no reset, verification, Google, or policy UI', () => {
      expect(page.querySelector('h1')?.textContent?.trim()).toBe('Sign in');
      expect(page.querySelector('h1')?.id).toBe('sign-in-heading');
      expect(page.querySelector('main form')?.getAttribute('aria-labelledby')).toBe(
        'sign-in-heading',
      );
      expect(page.querySelector('main form')?.hasAttribute('novalidate')).toBe(true);
      expect(page.querySelector('main h1 + p')?.textContent?.trim()).toBe(
        'Pick up where you left off: register for a season, manage your team, or run your organization.',
      );
      for (const absent of [
        'Forgot password',
        'verify',
        'Google',
        'at least 15',
        'All fields are required',
      ]) {
        expect(page.textContent).not.toContain(absent);
      }
    });

    it('labels each field and sets its type and autocomplete', () => {
      const expectations: [string, string, string, Record<string, string | null>][] = [
        [
          'email',
          'Email',
          'email',
          { autocomplete: 'email', spellcheck: 'false', autocapitalize: 'none' },
        ],
        [
          'password',
          'Password',
          'password',
          { autocomplete: 'current-password', spellcheck: 'false', autocapitalize: 'none' },
        ],
      ];
      for (const [id, label, typeName, attributes] of expectations) {
        const element = input(id);
        expect(page.querySelector(`label[for="${id}"]`)?.textContent?.trim()).toBe(label);
        expect(element.type).toBe(typeName);
        expect(element.required).toBe(true);
        expect(element.hasAttribute('aria-invalid')).toBe(false);
        expect(element.hasAttribute('aria-describedby')).toBe(false);
        for (const [name, value] of Object.entries(attributes)) {
          expect(element.getAttribute(name), `${id} ${name}`).toBe(value);
        }
      }
      expect(input('password').hasAttribute('maxlength')).toBe(false);
    });

    it("draws the buttons with the mockup's unmerged class strings", () => {
      const classes = (element: Element) => [...element.classList].sort();
      const expected = (value: string) => value.split(' ').sort();
      expect(classes(showButton())).toEqual(
        expected(buttonVariants({ variant: 'outline', size: 'md' })),
      );
      expect(classes(submitButton())).toEqual(
        expected(`${buttonVariants({ size: 'md' })} mt-6 w-full`),
      );
      expect(submitButton().textContent?.trim()).toBe('Sign in');
    });

    it('Show password reveals the password, says so politely, and Hide covers it again', async () => {
      const button = showButton();
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Show password');
      button.click();
      await harness.fixture.whenStable();
      expect(input('password').type).toBe('text');
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Hide password');
      const status = input('password')
        .closest('[data-slot="field"]')
        ?.querySelector('[role="status"]');
      expect(status?.textContent?.trim()).toBe('Your password is shown.');
      button.click();
      await harness.fixture.whenStable();
      expect(input('password').type).toBe('password');
    });
  });

  describe('the link to sign-up', () => {
    it('keeps a valid returnTo', async () => {
      await open('/sign-in?returnTo=%2Fleagues%2Fx%2Fregister');
      expect(page.querySelector('main form ~ p')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'New to Omni League? Create an account',
      );
      expect(createAccount()?.getAttribute('href')).toBe(
        '/sign-up?returnTo=%2Fleagues%2Fx%2Fregister',
      );
    });

    it.each([
      ['/sign-in', '/sign-up?returnTo=%2Fapp'],
      ['/sign-in?returnTo=%2F%2Fevil.example%2Fx', '/sign-up?returnTo=%2Fapp'],
      ['/sign-in?returnTo=https%3A%2F%2Fevil.example', '/sign-up?returnTo=%2Fapp'],
    ])('from %s goes to %s: an unsafe returnTo is dropped', async (from, href) => {
      await open(from);
      expect(createAccount()?.getAttribute('href')).toBe(href);
    });
  });

  describe('client-side errors', () => {
    beforeEach(() => open());

    it('submitted empty: both errors, aria-invalid and aria-describedby, focus on Email, nothing sent', async () => {
      await submit();
      expect(error('email')).toBe(MESSAGES.emailEmpty);
      expect(error('password')).toBe(MESSAGES.passwordEmpty);
      for (const id of ['email', 'password']) {
        expect(input(id).getAttribute('aria-invalid'), id).toBe('true');
        expect(input(id).getAttribute('aria-describedby'), id).toBe(`${id}-error`);
        expect(page.querySelector(`#${id}-error`)?.getAttribute('role')).toBe('alert');
      }
      expect(document.activeElement).toBe(input('email'));
      expect(client.signIns).toEqual([]);
    });

    it('a malformed email gets the rule, and focus', async () => {
      await fill({ email: 'maya.okafor.example.com' });
      await submit();
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      expect(error('password')).toBeNull();
      expect(document.activeElement).toBe(input('email'));
      expect(client.signIns).toEqual([]);
    });

    it('a short password is not a client-side error: there is no length check on sign-in', async () => {
      await fill({ password: 'short' });
      await submit();
      expect(error('password')).toBeNull();
      expect(client.signIns).toEqual([{ email: EMAIL, password: 'short' }]);
    });

    it('with only the password empty, focus goes to Password', async () => {
      await fill({ password: '' });
      await submit();
      expect(error('email')).toBeNull();
      expect(error('password')).toBe(MESSAGES.passwordEmpty);
      expect(document.activeElement).toBe(input('password'));
    });

    it('an error clears once its field is valid, and is not shown again while typing', async () => {
      await submit();
      await type('email', EMAIL);
      expect(error('email')).toBeNull();
      expect(input('email').hasAttribute('aria-invalid')).toBe(false);
      await type('email', '');
      expect(error('email')).toBeNull();
      expect(error('password')).toBe(MESSAGES.passwordEmpty);
    });
  });

  describe('checking a field when the user leaves it', () => {
    beforeEach(() => open());

    async function leave(id: string) {
      input(id).dispatchEvent(new Event('blur'));
      await harness.fixture.whenStable();
    }

    it('shows the error with aria-invalid and aria-describedby once a changed field is left', async () => {
      await type('email', 'maya.okafor.example.com');
      await leave('email');
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      expect(input('email').getAttribute('aria-invalid')).toBe('true');
      expect(input('email').getAttribute('aria-describedby')).toBe('email-error');

      await type('password', 'x');
      await type('password', '');
      await leave('password');
      expect(error('password')).toBe(MESSAGES.passwordEmpty);
      expect(input('password').getAttribute('aria-describedby')).toBe('password-error');
    });

    it('shows nothing while the user types an invalid partial value', async () => {
      await type('email', 'maya');
      expect(error('email')).toBeNull();
      expect(input('email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows nothing when focus passes through a field that was never changed; a submit still shows it', async () => {
      await leave('email');
      await leave('password');
      expect(error('email')).toBeNull();
      expect(error('password')).toBeNull();
      await submit();
      expect(error('email')).toBe(MESSAGES.emailEmpty);
      expect(error('password')).toBe(MESSAGES.passwordEmpty);
    });

    it('clears the error on the keystroke that makes the value valid', async () => {
      await type('email', 'maya');
      await leave('email');
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      await type('email', EMAIL);
      expect(error('email')).toBeNull();
    });
  });

  describe('submitting', () => {
    it('sends the trimmed email and the password, and goes to /app with no returnTo', async () => {
      await open();
      await fill({ email: ` ${EMAIL} ` });
      await submit();
      expect(client.signIns).toEqual([{ email: EMAIL, password: PASSWORD }]);
      expect(url()).toBe('/app');
    });

    it('replaces /sign-in in the history, so Back skips the finished form', async () => {
      await open('/sign-in?returnTo=%2Fleagues%2Fx%2Fregister');
      await fill();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      await submit();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/leagues/x/register', {
        replaceUrl: true,
      });
    });

    it.each([
      ['/sign-in?returnTo=%2Fapp', '/app'],
      ['/sign-in?returnTo=%2F', '/app'],
      ['/sign-in?returnTo=%2F%3Fx%3D1', '/app'],
      ['/sign-in?returnTo=%2Fleagues%2Fx%2Fregister', '/leagues/x/register'],
      ['/sign-in?returnTo=%2F%2Fevil.example%2Fx', '/app'],
      ['/sign-in?returnTo=%2F%5Cevil.example', '/app'],
      ['/sign-in?returnTo=https%3A%2F%2Fevil.example', '/app'],
      ['/sign-in?returnTo=%2F..%2F%2Fevil.example%2Fx', '/app'],
    ])('from %s goes to %s', async (from, to) => {
      await open(from);
      await fill();
      await submit();
      expect(url()).toBe(to);
    });

    it('shows "Signing in…", is aria-disabled, ignores a second press, and hides the password', async () => {
      await open();
      await fill();
      showButton().click();
      await harness.fixture.whenStable();
      client.holdSignIn = true;
      await submit();
      expect(input('password').type).toBe('password');
      expect(submitButton().textContent?.trim()).toBe('Signing in…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(page.querySelector('form > p[role="status"]')?.textContent?.trim()).toBe(
        'Signing in.',
      );
      await submit();
      expect(client.signIns).toHaveLength(1);
      client.releaseSignIn();
      await submit();
      expect(url()).toBe('/app');
    });
  });

  describe('server answers', () => {
    beforeEach(() => open());

    it('401: "Email or password is incorrect." in the form alert, which takes focus', async () => {
      await fill();
      client.nextSignInError = { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' };
      await submit();
      expect(alert()?.getAttribute('role')).toBe('alert');
      expect(alert()?.getAttribute('tabindex')).toBe('-1');
      expect(alertTitle()).toBe('Email or password is incorrect.');
      expect(alertDescription()).toBe('Check both and try again.');
      expect(document.activeElement).toBe(alert());
      expect(url()).toBe('/sign-in');
      for (const id of ['email', 'password']) {
        expect(input(id).hasAttribute('aria-invalid'), id).toBe(false);
        expect(error(id), id).toBeNull();
      }
    });

    it('keeps both entered values after a wrong password, and Show still reveals the password', async () => {
      await fill();
      client.nextSignInError = { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' };
      await submit();
      expect(input('email').value).toBe(EMAIL);
      expect(input('password').value).toBe(PASSWORD);
      showButton().click();
      await harness.fixture.whenStable();
      expect(input('password').type).toBe('text');
      expect(input('password').value).toBe(PASSWORD);
    });

    it('a later successful press clears the alert and goes on', async () => {
      await fill();
      client.nextSignInError = { status: 401 };
      await submit();
      expect(alert()).not.toBeNull();
      client.nextSignInError = null;
      await submit();
      expect(url()).toBe('/app');
    });

    it.each([
      [60, 'Too many attempts. Try again in 1 minute.'],
      [61, 'Too many attempts. Try again in 2 minutes.'],
      [240, 'Too many attempts. Try again in 4 minutes.'],
      [3600, 'Too many attempts. Try again in 60 minutes.'],
    ])('429 with %i seconds left: %j', async (retryAfterSeconds, title) => {
      await fill();
      client.nextSignInError = { status: 429, code: 'TOO_MANY_ATTEMPTS', retryAfterSeconds };
      await submit();
      expect(alertTitle()).toBe(title);
      expect(alertDescription()).toBe(
        'Sign-in for this email address is paused after several incorrect passwords.',
      );
      expect(document.activeElement).toBe(alert());
      expect(submitButton().getAttribute('aria-disabled')).toBeNull();
      expect(input('email').value).toBe(EMAIL);
    });

    it('429 at the hard limit: the lock text, and the values stay', async () => {
      await fill();
      client.nextSignInError = { status: 429, code: 'SIGN_IN_LOCKED' };
      await submit();
      expect(alertTitle()).toBe('Password sign-in is locked for this email address.');
      expect(alertDescription()).toBe(
        'There have been too many incorrect attempts. Contact the Omni League team to unlock it.',
      );
      expect(document.activeElement).toBe(alert());
      expect(input('password').value).toBe(PASSWORD);
    });

    it('400 invalid email: on the Email field, which takes focus', async () => {
      await fill();
      client.nextSignInError = { status: 400, code: 'INVALID_EMAIL' };
      await submit();
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      expect(document.activeElement).toBe(input('email'));
      await type('email', 'other@example.com');
      expect(error('email')).toBeNull();
    });

    it('any other failure: the generic alert', async () => {
      await fill();
      client.signInThrows = new TypeError('Failed to fetch');
      await submit();
      expect(alertTitle()).toBe('Sign-in could not be completed.');
      expect(alertDescription()).toBe('Check your connection and try again.');
      expect(document.activeElement).toBe(alert());
    });
  });
});
