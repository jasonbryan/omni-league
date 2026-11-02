import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { MESSAGES, SignUpPage } from './sign-up-page';

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

  it('renders in the public layout: top bar and footer, no sidebar', async () => {
    await open();
    expect(page.firstElementChild?.tagName).toBe('APP-PUBLIC-LAYOUT');
    expect(page.querySelectorAll('header')).toHaveLength(1);
    expect(page.querySelectorAll('footer')).toHaveLength(1);
    expect(page.querySelector('main#main')).not.toBeNull();
    expect(page.querySelector('button[aria-label="Open navigation"]')).toBeNull();
  });

  describe('fields (mockup "Sign-up field attributes")', () => {
    beforeEach(() => open());

    it('has the heading, the required note, and no reset, verification, or Google UI', () => {
      expect(page.querySelector('h1')?.textContent?.trim()).toBe('Create your account');
      expect(page.querySelector('main form')?.getAttribute('aria-labelledby')).toBe(
        'sign-up-heading',
      );
      expect(page.querySelector('main form')?.hasAttribute('novalidate')).toBe(true);
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
        expected(buttonVariants({ variant: 'outline', size: 'md' })),
      );
      expect(classes(showButton())).toEqual(
        expect.arrayContaining(['border-transparent', 'border-border']),
      );
      expect(classes(submitButton())).toEqual(
        expected(`${buttonVariants({ size: 'md' })} mt-6 w-full`),
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
      const status = input('password')
        .closest('[data-slot="field"]')
        ?.querySelector('[role="status"]');
      expect(status?.textContent?.trim()).toBe('Your password is shown.');
      button.click();
      await harness.fixture.whenStable();
      expect(input('password').type).toBe('password');
    });
  });

  describe('the links to sign-in keep a valid returnTo', () => {
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

    it('a name over 100 characters: its own message on Name, which takes focus; nothing is sent', async () => {
      await fill({ name: 'x'.repeat(101) });
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer.');
      expect(input('name').getAttribute('aria-invalid')).toBe('true');
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description name-error');
      expect(error('email')).toBeNull();
      expect(error('password')).toBeNull();
      expect(document.activeElement).toBe(input('name'));
      expect(client.signUps).toEqual([]);
    });

    it.each([
      ['100 characters', 'x'.repeat(100)],
      ['100 characters plus surrounding spaces', `  ${'x'.repeat(100)}   `],
    ])('a name of %s shows no Name error and signs up', async (_, name) => {
      await fill({ name });
      await submit();
      expect(error('name')).toBeNull();
      expect(client.signUps).toEqual([
        { name: 'x'.repeat(100), email: EMAIL, password: PASSWORD, adultConfirmed: true },
      ]);
    });

    it.each([
      ['50 emoji (100 UTF-16 units)', '\u{1F3D0}'.repeat(50)],
      ['100 accented letters', '\u00e9'.repeat(100)],
      ['100 CJK characters', '海'.repeat(100)],
      ['99 letters and an emoji at the edge, trimmed', `\u3000${'x'.repeat(98)}\u{1F3D0}\t`],
    ])(
      'a name of %s, counted as String.length after trimming, is accepted and sent trimmed',
      async (_, name) => {
        await fill({ name });
        await submit();
        expect(error('name')).toBeNull();
        expect(client.signUps.map((s) => s['name'])).toEqual([name.trim()]);
      },
    );

    it.each([
      ['51 emoji (102 UTF-16 units)', '\u{1F3D0}'.repeat(51)],
      ['100 letters and one emoji', `${'x'.repeat(100)}\u{1F3D0}`],
      ['101 accented letters', '\u00e9'.repeat(101)],
      ['101 letters between no-break and ideographic spaces', `\u00a0${'x'.repeat(101)}\u3000`],
    ])(
      'a name of %s, counted as String.length after trimming, is refused and nothing is sent',
      async (_, name) => {
        await fill({ name });
        await submit();
        expect(error('name')).toBe(MESSAGES.nameLong);
        expect(document.activeElement).toBe(input('name'));
        expect(client.signUps).toEqual([]);
      },
    );

    it('the over-long name error clears once the name is 100 characters or fewer', async () => {
      await fill({ name: 'x'.repeat(101) });
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer.');
      await type('name', 'x'.repeat(100));
      expect(error('name')).toBeNull();
      expect(input('name').hasAttribute('aria-invalid')).toBe(false);
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
      expect(error('email')).toBe(MESSAGES.emailEmpty);
    });
  });

  describe('checking a field when the user leaves it', () => {
    beforeEach(() => open());

    async function leave(id: string) {
      // A browser fires both; Password and its Show button are checked on `focusout`.
      input(id).dispatchEvent(new Event('blur'));
      input(id).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await harness.fixture.whenStable();
    }

    it('shows the error with aria-invalid and aria-describedby once a changed field is left', async () => {
      await type('email', 'maya.okafor.example.com');
      await leave('email');
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      expect(input('email').getAttribute('aria-invalid')).toBe('true');
      expect(input('email').getAttribute('aria-describedby')).toBe('email-error');
    });

    it('shows nothing while the user types an invalid partial value', async () => {
      await type('email', 'maya');
      expect(error('email')).toBeNull();
      expect(input('email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows nothing when focus passes through a field that was never changed; a submit still shows it', async () => {
      await leave('name');
      await leave('email');
      expect(error('name')).toBeNull();
      expect(error('email')).toBeNull();
      await submit();
      expect(error('name')).toBe(MESSAGES.nameEmpty);
      expect(error('email')).toBe(MESSAGES.emailEmpty);
    });

    it('shows the over-long name message once a name over 100 characters is left, not while typing', async () => {
      await type('name', 'x'.repeat(101));
      expect(error('name')).toBeNull();
      await leave('name');
      expect(error('name')).toBe(MESSAGES.nameLong);
      expect(input('name').getAttribute('aria-invalid')).toBe('true');
    });

    it('clears the error on the keystroke that makes the value valid', async () => {
      await type('email', 'maya');
      await leave('email');
      expect(error('email')).toBe(MESSAGES.emailMalformed);
      await type('email', EMAIL);
      expect(error('email')).toBeNull();
      expect(input('email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('checks the name, the password, and the 18+ confirmation the same way', async () => {
      await type('name', 'Maya');
      await type('name', '  ');
      await leave('name');
      expect(error('name')).toBe(MESSAGES.nameEmpty);

      await type('password', 'tenletters');
      await leave('password');
      expect(error('password')).toBe('Use at least 15 characters. This password has 10.');

      checkbox().click();
      checkbox().click();
      checkbox().dispatchEvent(new Event('blur'));
      await harness.fixture.whenStable();
      expect(error('adult')).toBe(MESSAGES.adult);
      expect(checkbox().getAttribute('aria-invalid')).toBe('true');
      expect(checkbox().getAttribute('aria-describedby')).toBe('adult-description adult-error');
    });

    it('does not check the password while focus moves to Show password, and does once it leaves Show', async () => {
      await type('password', 'tenletters');
      input('password').dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: showButton() }),
      );
      await harness.fixture.whenStable();
      expect(error('password')).toBeNull();
      // Tabbing past Show to the 18+ checkbox leaves the Password field and its Show button.
      showButton().dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: checkbox() }),
      );
      await harness.fixture.whenStable();
      expect(error('password')).toBe('Use at least 15 characters. This password has 10.');
    });

    it('checks the password when focus moves from it to another field', async () => {
      await type('password', 'tenletters');
      input('password').dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: checkbox() }),
      );
      await harness.fixture.whenStable();
      expect(error('password')).toBe('Use at least 15 characters. This password has 10.');
    });

    it('a server refusal about a field shows under it until the field changes', async () => {
      await fill();
      client.nextSignUpError = { status: 422, code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' };
      await submit();
      expect(error('email')).toContain('already exists');
      await leave('email');
      expect(error('email')).toContain('already exists');
      await type('email', 'maya.other@example.com');
      expect(error('email')).toBeNull();
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
      ['/sign-up?returnTo=%2F%2Fevil.example%2Fx', '/app'],
      ['/sign-up?returnTo=https%3A%2F%2Fevil.example', '/app'],
      ['/sign-up?returnTo=%2F', '/app'],
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
      const link = page.querySelector<HTMLAnchorElement>('#email-error a');
      expect(link?.textContent?.trim()).toBe('Sign in instead');
      expect(link?.getAttribute('href')).toBe('/sign-in?returnTo=%2Fapp');
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

    it('breached check unavailable: the exact text in the form alert, which takes focus', async () => {
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

      client.nextSignUpError = null;
      await submit();
      expect(url()).toBe('/app');
    });

    it('400 NAME_INVALID: the over-long message on Name, which takes focus; no alert; cleared by editing it', async () => {
      await fill();
      client.nextSignUpError = { status: 400, code: 'NAME_INVALID' };
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer.');
      expect(input('name').getAttribute('aria-invalid')).toBe('true');
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description name-error');
      expect(alert()).toBeNull();
      expect(document.activeElement).toBe(input('name'));
      expect(url()).toBe('/sign-up');
      await type('name', 'Maya');
      expect(error('name')).toBeNull();
    });

    it.each([
      ['an unknown code', { status: 400, code: 'SOMETHING_ELSE' }],
      ['AUTH_NOT_CONFIGURED', { status: 503, code: 'AUTH_NOT_CONFIGURED' }],
    ])('%s: the generic alert, not a field error', async (_, failure) => {
      await fill();
      client.nextSignUpError = failure;
      await submit();
      expect(alert()?.querySelector('[data-slot="alert-description"]')?.textContent?.trim()).toBe(
        'Check your connection and try again.',
      );
      expect(error('name')).toBeNull();
    });

    describe('429 from the per-IP limit', () => {
      const LIMITED = { status: 429, message: 'Too many requests. Please try again later.' };
      const alertText = (slot: string) =>
        alert()?.querySelector(`[data-slot="alert-${slot}"]`)?.textContent?.trim() ?? null;

      it('shows the network alert, which takes focus, and keeps the form as it was', async () => {
        await fill();
        client.nextSignUpError = LIMITED;
        await submit();
        expect(alert()?.getAttribute('role')).toBe('alert');
        expect(alertText('title')).toBe('Too many attempts. Try again in 10 seconds.');
        expect(alertText('description')).toBe(
          'Several sign-ups came from this network in a short time. No account was created.',
        );
        expect(document.activeElement).toBe(alert());
        expect(input('name').value).toBe(NAME);
        expect(input('email').value).toBe(EMAIL);
        expect(input('password').value).toBe(PASSWORD);
        expect(checkbox().getAttribute('aria-checked')).toBe('true');
        for (const id of ['name', 'email', 'password']) {
          expect(input(id).hasAttribute('aria-invalid'), id).toBe(false);
          expect(error(id), id).toBeNull();
        }
        expect(checkbox().hasAttribute('aria-invalid')).toBe(false);
        expect(error('adult')).toBeNull();
        expect(submitButton().textContent?.trim()).toBe('Create account');
        expect(submitButton().getAttribute('aria-disabled')).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await harness.fixture.whenStable();
        expect(client.signUps).toHaveLength(1);
      });

      it('a new press clears the alert, shows "Creating account…", and sends one request', async () => {
        await fill();
        client.nextSignUpError = LIMITED;
        await submit();
        expect(alert()).not.toBeNull();
        client.nextSignUpError = null;
        client.holdSignUp = true;
        await submit();
        expect(alert()).toBeNull();
        expect(submitButton().textContent?.trim()).toBe('Creating account…');
        expect(client.signUps).toHaveLength(2);
        client.releaseSignUp();
        await submit();
        expect(client.signUps).toHaveLength(2);
        expect(url()).toBe('/app');
      });
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
