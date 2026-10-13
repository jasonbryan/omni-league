import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { MESSAGES, SignUpPage } from './sign-up-page';

// /sign-up (#62), design/mockups/62-sign-up.html. Each case drives the real AuthService through a
// fake Better Auth client.

@Component({ template: 'elsewhere' })
class Elsewhere {}

const NAME = 'Maya Okafor';
const EMAIL = 'maya.okafor@example.com';
const PASSWORD = 'sandbar sunset spike 2026';

describe('SignUpPage', () => {
  let client: FakeAuthClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open(url = '/sign-up') {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(client),
        provideRouter([
          { path: 'sign-up', component: SignUpPage },
          { path: 'sign-in', component: Elsewhere },
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
  const checkbox = () => page.querySelector<HTMLButtonElement>('#adult')!;
  const submitButton = () => page.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const showButton = () =>
    page.querySelector<HTMLButtonElement>('button[aria-controls="password"]')!;
  const error = (id: string) => page.querySelector(`#${id}-error`)?.textContent?.trim() ?? null;
  const alert = () => page.querySelector<HTMLElement>('#form-error');
  const url = () => TestBed.inject(Router).url;

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function fill({
    name = NAME,
    email = EMAIL,
    password = PASSWORD,
    adult = true,
  }: { name?: string; email?: string; password?: string; adult?: boolean } = {}) {
    await type('name', name);
    await type('email', email);
    await type('password', password);
    if (adult !== (checkbox().getAttribute('aria-checked') === 'true')) checkbox().click();
    await harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  }

  describe('fields (mockup "Sign-up field attributes")', () => {
    beforeEach(() => open());

    it('has the heading, the required note, and no reset, verification, or Google UI', () => {
      expect(page.querySelector('h1')?.textContent?.trim()).toBe('Create your account');
      expect(page.querySelector('form')?.getAttribute('aria-labelledby')).toBe('sign-up-heading');
      expect(page.querySelector('form')?.hasAttribute('novalidate')).toBe(true);
      expect(page.textContent).toContain('All fields are required.');
      for (const absent of ['Forgot password', 'verify', 'Google']) {
        expect(page.textContent).not.toContain(absent);
      }
    });

    it('has the panel footer "Already have an account? Sign in", linking to /sign-in', () => {
      const footer = page.querySelector('main form ~ p');
      expect(footer?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Already have an account? Sign in',
      );
      // No returnTo: sign-up lands on /app, so sign-in does too (mockup 62).
      expect(footer?.querySelector('a')?.getAttribute('href')).toBe('/sign-in?returnTo=%2Fapp');
    });

    it('labels each field and sets its type, autocomplete, and description', () => {
      const expectations: [string, string, string, Record<string, string | null>][] = [
        ['name', 'Name', 'text', { autocomplete: 'name', autocapitalize: 'words' }],
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
          { autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'none' },
        ],
      ];
      for (const [id, label, typeName, attributes] of expectations) {
        const element = input(id);
        expect(page.querySelector(`label[for="${id}"]`)?.textContent?.trim()).toBe(label);
        expect(element.type).toBe(typeName);
        expect(element.required).toBe(true);
        expect(element.hasAttribute('aria-invalid')).toBe(false);
        for (const [name, value] of Object.entries(attributes)) {
          expect(element.getAttribute(name), `${id} ${name}`).toBe(value);
        }
      }
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description');
      expect(page.querySelector('#name-description')?.textContent?.trim()).toBe(
        'Shown to your teammates and organizers.',
      );
      expect(input('email').hasAttribute('aria-describedby')).toBe(false);
      expect(input('password').getAttribute('aria-describedby')).toBe('password-description');
      expect(page.querySelector('#password-description')?.textContent?.trim()).toBe(
        'At least 15 characters; a phrase of several words works.',
      );
      // No maxlength, so a long paste is never cut silently.
      expect(input('password').hasAttribute('maxlength')).toBe(false);
      expect(input('password').hasAttribute('minlength')).toBe(false);
    });

    it('has the 18+ checkbox as a button with role checkbox, labelled and described', () => {
      const box = checkbox();
      expect(box.tagName).toBe('BUTTON');
      expect(box.getAttribute('type')).toBe('button');
      expect(box.getAttribute('role')).toBe('checkbox');
      expect(box.getAttribute('aria-checked')).toBe('false');
      expect(box.getAttribute('aria-required')).toBe('true');
      expect(box.getAttribute('aria-describedby')).toBe('adult-description');
      expect(page.querySelector('label[for="adult"]')?.textContent?.trim()).toBe(
        'I am 18 or older',
      );
      box.click();
      harness.fixture.detectChanges();
      expect(box.getAttribute('aria-checked')).toBe('true');
      expect(box.getAttribute('data-state')).toBe('checked');
      expect(box.querySelector('ng-icon')).not.toBeNull();
    });

    it("draws the buttons with the mockup's unmerged class strings (outline: no visible edge)", () => {
      const classes = (element: Element) => [...element.classList].sort();
      const expected = (value: string) => value.split(' ').sort();
      expect(classes(showButton())).toEqual(
        expected(buttonVariants({ variant: 'outline', size: 'lg' })),
      );
      expect(classes(showButton())).toEqual(
        expect.arrayContaining(['border-transparent', 'border-border']),
      );
      expect(classes(submitButton())).toEqual(
        expected(`${buttonVariants({ size: 'lg' })} mt-6 w-full`),
      );
      expect(submitButton().getAttribute('data-slot')).toBe('button');
    });

    it('Show password reveals the password, says so politely, and Hide covers it again', async () => {
      const button = showButton();
      expect(button.getAttribute('type')).toBe('button');
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Show password');
      button.click();
      await harness.fixture.whenStable();
      expect(input('password').type).toBe('text');
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Hide password');
      // The password field's own status, not the shell's offline note (also `role="status"`, #115).
      const status = input('password')
        .closest('[data-slot="field"]')
        ?.querySelector('[role="status"]');
      expect(status?.textContent?.trim()).toBe('Your password is shown.');
      button.click();
      await harness.fixture.whenStable();
      expect(input('password').type).toBe('password');
    });
  });

  describe('the links to sign-in keep a valid returnTo (#63)', () => {
    it.each([
      [
        '/sign-up?returnTo=%2Fleagues%2Fx%2Fregister',
        '/sign-in?returnTo=%2Fleagues%2Fx%2Fregister',
      ],
      ['/sign-up?returnTo=%2F%2Fevil.example%2Fx', '/sign-in?returnTo=%2Fapp'],
      ['/sign-up?returnTo=https%3A%2F%2Fevil.example', '/sign-in?returnTo=%2Fapp'],
    ])('from %s the footer link goes to %s', async (from, href) => {
      await open(from);
      expect(page.querySelector('main form ~ p a')?.getAttribute('href')).toBe(href);
    });
  });

  describe('client-side errors', () => {
    beforeEach(() => open());

    it('submitted empty: every field error, aria-invalid and aria-describedby, focus on Name', async () => {
      await submit();
      expect(error('name')).toBe(MESSAGES.nameEmpty);
      expect(error('email')).toBe(MESSAGES.emailEmpty);
      expect(error('password')).toBe(MESSAGES.passwordEmpty);
      expect(error('adult')).toBe(MESSAGES.adult);
      for (const id of ['name', 'email', 'password']) {
        expect(input(id).getAttribute('aria-invalid'), id).toBe('true');
        expect(input(id).getAttribute('aria-describedby'), id).toContain(`${id}-error`);
        expect(page.querySelector(`#${id}-error`)?.getAttribute('role')).toBe('alert');
      }
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description name-error');
      expect(input('email').getAttribute('aria-describedby')).toBe('email-error');
      expect(checkbox().getAttribute('aria-invalid')).toBe('true');
      expect(checkbox().getAttribute('aria-describedby')).toBe('adult-description adult-error');
      expect(document.activeElement).toBe(input('name'));
      expect(client.signUps).toEqual([]);
    });

    it('invalid email and short password: the rule and the count, focus on Email', async () => {
      await fill({ email: 'maya.okafor.example.com', password: 'tenletters' });
      await submit();
      expect(error('name')).toBeNull();
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      expect(error('password')).toBe('Use at least 15 characters. This password has 10.');
      expect(document.activeElement).toBe(input('email'));
      expect(client.signUps).toEqual([]);
    });

    it('a password over 128 characters gets its own message', async () => {
      await fill({ password: 'x'.repeat(131) });
      await submit();
      expect(error('password')).toBe('Use 128 characters or fewer. This password has 131.');
      expect(document.activeElement).toBe(input('password'));
    });

    it('without the 18+ confirmation: the error is on the checkbox, which takes focus', async () => {
      await fill({ adult: false });
      await submit();
      expect(error('adult')).toBe(MESSAGES.adult);
      expect(document.activeElement).toBe(checkbox());
      expect(client.signUps).toEqual([]);
    });

    it('an error clears once its field is valid, and is not shown again while typing', async () => {
      await submit();
      await type('name', NAME);
      expect(error('name')).toBeNull();
      expect(input('name').hasAttribute('aria-invalid')).toBe(false);
      await type('name', '');
      expect(error('name')).toBeNull();
      // The others are still shown.
      expect(error('email')).toBe(MESSAGES.emailEmpty);
    });
  });

  describe('submitting', () => {
    it('sends the trimmed values with the 18+ confirmation and goes to /app', async () => {
      await open();
      await fill({ name: `  ${NAME} `, email: ` ${EMAIL} ` });
      await submit();
      expect(client.signUps).toEqual([
        { name: NAME, email: EMAIL, password: PASSWORD, adultConfirmed: true },
      ]);
      expect(url()).toBe('/app');
    });

    it('replaces /sign-up in the history, so Back skips the finished form', async () => {
      await open();
      await fill();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      await submit();
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/app', { replaceUrl: true });
    });

    it.each([
      ['/sign-up?returnTo=%2Fleagues%2Fx%2Fregister', '/leagues/x/register'],
      ['/sign-up?returnTo=%2F%2Fevil.example%2Fx', '/'],
      ['/sign-up?returnTo=https%3A%2F%2Fevil.example', '/'],
    ])('from %s goes to %s', async (from, to) => {
      await open(from);
      await fill();
      await submit();
      expect(url()).toBe(to);
    });

    it('shows "Creating account…", is aria-disabled, ignores a second press, and hides the password', async () => {
      await open();
      await fill();
      showButton().click();
      await harness.fixture.whenStable();
      client.holdSignUp = true;
      await submit();
      expect(input('password').type).toBe('password');
      expect(submitButton().textContent?.trim()).toBe('Creating account…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(page.querySelector('form > p[role="status"]')?.textContent?.trim()).toBe(
        'Creating your account.',
      );
      await submit();
      expect(client.signUps).toHaveLength(1);
      client.releaseSignUp();
      await submit();
      expect(url()).toBe('/app');
    });
  });

  describe('server answers', () => {
    beforeEach(() => open());

    it('422 already exists: on the Email field, which takes focus; cleared by editing it', async () => {
      await fill();
      client.nextSignUpError = { status: 422, code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' };
      await submit();
      expect(error('email')).toBe('An account with this email already exists. Sign in instead.');
      expect(input('email').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('email'));
      expect(url()).toBe('/sign-up');
      // "Sign in instead" is a link to /sign-in with the same returnTo (#63).
      const link = page.querySelector<HTMLAnchorElement>('#email-error a');
      expect(link?.textContent?.trim()).toBe('Sign in instead');
      expect(link?.getAttribute('href')).toBe('/sign-in?returnTo=%2Fapp');
      // Values stay.
      expect(input('name').value).toBe(NAME);
      expect(input('password').value).toBe(PASSWORD);
      await type('email', 'other@example.com');
      expect(error('email')).toBeNull();
    });

    it('400 breached: the approved message on Password, which takes focus', async () => {
      await fill({ password: 'passwordpassword' });
      client.nextSignUpError = { status: 400, code: 'PASSWORD_COMPROMISED' };
      await submit();
      expect(error('password')).toBe(MESSAGES.breached);
      expect(document.activeElement).toBe(input('password'));
    });

    it("breached check unavailable: ADR 0008's exact text in the form alert, which takes focus", async () => {
      await fill();
      client.nextSignUpError = {
        status: 500,
        message: 'Failed to check password. Please try again later.',
      };
      await submit();
      const box = alert();
      expect(box?.getAttribute('role')).toBe('alert');
      expect(box?.getAttribute('tabindex')).toBe('-1');
      expect(box?.querySelector('[data-slot="alert-title"]')?.textContent?.trim()).toBe(
        'Failed to check password. Please try again later.',
      );
      expect(box?.querySelector('[data-slot="alert-description"]')).toBeNull();
      expect(document.activeElement).toBe(box);
      expect(input('email').value).toBe(EMAIL);

      // A later successful press clears it.
      client.nextSignUpError = null;
      await submit();
      expect(url()).toBe('/app');
    });

    it('any other failure: the generic alert', async () => {
      await fill();
      client.signUpThrows = new TypeError('Failed to fetch');
      await submit();
      expect(alert()?.querySelector('[data-slot="alert-title"]')?.textContent?.trim()).toBe(
        'Sign-up could not be completed.',
      );
      expect(alert()?.querySelector('[data-slot="alert-description"]')?.textContent?.trim()).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert());
    });
  });
});
