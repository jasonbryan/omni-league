import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { ORGANIZATION_MESSAGES } from '../../../convex/lib/organizationInput';
import { slugify } from '../../../convex/lib/slugs';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { CreateOrganizationPage } from './create-organization-page';

// /app/organizations/new (#64), design/mockups/64-create-organization.html states 5 to 12 and
// design/mockups/88-offline-note.html states 2 and 3.

@Component({ template: 'elsewhere' })
class Elsewhere {}

const NAME = 'Coastal Bend Rec Club';
const SLUG = 'coastal-bend-rec-club';
const CREATE = 'organizations:create';

describe('CreateOrganizationPage', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open() {
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(new FakeAuthClient()),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([
          { path: 'app/organizations/new', component: CreateOrganizationPage },
          { path: 'app', component: Elsewhere },
          { path: 'app/organizations/:slug', component: Elsewhere },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create('/app/organizations/new');
    page = harness.routeNativeElement!;
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const submitButton = () => page.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = (id: string) =>
    page.querySelector(`#${id}-error`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const alert = () => page.querySelector<HTMLElement>('#form-error');
  const status = () => page.querySelector('form > p[role="status"]');
  const address = () =>
    page.querySelector('#slug-description span')?.textContent?.replace(/\s+/g, '').trim();
  const url = () => TestBed.inject(Router).url;
  const flush = async () => {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  };

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await flush();
  }

  describe('the form (mockup states 5 and 6, "Create-organization field attributes")', () => {
    beforeEach(() => open());

    it('has the back link, the heading, and a labelled form', () => {
      const back = page.querySelector<HTMLAnchorElement>('a[href="/app"]');
      expect(back?.textContent?.trim()).toBe('Your organizations');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(page.querySelector('h1')?.textContent?.trim()).toBe('Create an organization');
      expect(page.querySelector('h1')?.id).toBe('create-heading');
      const form = page.querySelector('form');
      expect(form?.getAttribute('aria-labelledby')).toBe('create-heading');
      expect(form?.hasAttribute('novalidate')).toBe(true);
      expect(page.textContent).toContain('You’ll be its first org admin.');
    });

    it('names the fields Name and Slug, with the attributes of the mockup', () => {
      expect(page.querySelector('label[for="name"]')?.textContent?.trim()).toBe('Name');
      expect(page.querySelector('label[for="slug"]')?.textContent?.trim()).toBe('Slug');
      expect(page.querySelector('label[for="slug"]')?.textContent).not.toContain('URL');
      const name = input('name');
      expect([name.type, name.required, name.getAttribute('autocomplete')]).toEqual([
        'text',
        true,
        'organization',
      ]);
      // No maxlength, so an over-long paste shows the error instead of being cut.
      expect(name.hasAttribute('maxlength')).toBe(false);
      expect(name.getAttribute('aria-describedby')).toBe('name-description');
      expect(page.querySelector('#name-description')?.textContent?.trim()).toBe(
        'Shown on your public page. Up to 100 characters.',
      );
      const slug = input('slug');
      expect([slug.type, slug.required, slug.getAttribute('autocomplete')]).toEqual([
        'text',
        true,
        'off',
      ]);
      expect(slug.getAttribute('spellcheck')).toBe('false');
      expect(slug.getAttribute('autocapitalize')).toBe('none');
      expect(slug.hasAttribute('maxlength')).toBe(false);
      expect(slug.getAttribute('aria-describedby')).toBe('slug-description');
    });

    it('shows the rule and the full public address under Slug, with a placeholder slug at first', () => {
      const description = page.querySelector('#slug-description')?.textContent;
      expect(description).toContain(
        '3 to 60 lowercase letters and digits, with single hyphens between them.',
      );
      expect(description).toContain('Your public page will be at');
      expect(address()).toBe(`${location.host}/organizations/your-slug`);
    });

    it("draws the buttons with the mockup's unmerged class strings", () => {
      expect([...submitButton().classList].sort()).toEqual(
        `${buttonVariants({ size: 'lg' })} mt-6 w-full`.split(' ').sort(),
      );
      expect(submitButton().textContent?.trim()).toBe('Create organization');
      expect(status()?.textContent?.trim()).toBe('');
    });
  });

  describe('Slug follows the name until it is edited (decision 3)', () => {
    beforeEach(() => open());

    it('typing a name sets Slug to slugify(name), and the address follows', async () => {
      await type('name', NAME);
      expect(input('slug').value).toBe(slugify(NAME));
      expect(input('slug').value).toBe(SLUG);
      expect(address()).toBe(`${location.host}/organizations/${SLUG}`);
      await type('name', 'Café Ñandú!');
      expect(input('slug').value).toBe('cafe-nandu');
      expect(address()).toBe(`${location.host}/organizations/cafe-nandu`);
    });

    it('emptying the name empties Slug, and the address shows the placeholder', async () => {
      await type('name', NAME);
      await type('name', '   ');
      expect(input('slug').value).toBe('');
      expect(address()).toBe(`${location.host}/organizations/your-slug`);
    });

    it('once the user edits Slug, the name no longer changes it', async () => {
      await type('name', NAME);
      await type('slug', 'my-own-slug');
      await type('name', 'Another Name Entirely');
      expect(input('slug').value).toBe('my-own-slug');
      expect(address()).toBe(`${location.host}/organizations/my-own-slug`);
      // Also after the user emptied Slug themselves.
      await type('slug', '');
      await type('name', 'Third Name');
      expect(input('slug').value).toBe('');
    });

    it('the address follows the slug as typed, even when it is not valid', async () => {
      await type('slug', 'Bad Slug');
      expect(address()).toBe(`${location.host}/organizations/BadSlug`);
    });
  });

  describe('client-side errors (mockup states 7, 8, and 9)', () => {
    beforeEach(() => open());

    it('submitted empty: both errors, aria-invalid and aria-describedby, focus on Name, nothing sent', async () => {
      await submit();
      expect(error('name')).toBe(ORGANIZATION_MESSAGES.nameEmpty);
      expect(error('slug')).toBe(ORGANIZATION_MESSAGES.slugEmpty);
      for (const id of ['name', 'slug']) {
        expect(input(id).getAttribute('aria-invalid'), id).toBe('true');
        expect(input(id).getAttribute('aria-describedby'), id).toBe(
          `${id}-description ${id}-error`,
        );
        expect(page.querySelector(`#${id}-error`)?.getAttribute('role')).toBe('alert');
      }
      expect(document.activeElement).toBe(input('name'));
      expect(convex.calls).toEqual([]);
    });

    it('a whitespace-only name counts as empty', async () => {
      await type('name', '    ');
      await type('slug', 'valid-slug');
      await submit();
      expect(error('name')).toBe('Enter your organization’s name.');
      expect(error('slug')).toBeNull();
      expect(convex.calls).toEqual([]);
    });

    it('Name valid and Slug empty: the slug message, focus on Slug', async () => {
      await type('name', NAME);
      await type('slug', '');
      await submit();
      expect(error('name')).toBeNull();
      expect(error('slug')).toBe('Enter a slug for your public page’s address.');
      expect(document.activeElement).toBe(input('slug'));
    });

    it('a 108-character name and the slug Coastal-Bend: the count and the format message', async () => {
      await type('name', 'n'.repeat(108));
      await type('slug', 'Coastal-Bend');
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer. This name has 108.');
      expect(error('slug')).toBe(ORGANIZATION_MESSAGES.slugInvalid);
      expect(error('slug')).toBe(
        'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.',
      );
      expect(document.activeElement).toBe(input('name'));
      expect(convex.calls).toEqual([]);
    });

    it('the format message prints the reserved slug new in bold, as mockup states 8 and 9 do', async () => {
      await type('name', NAME);
      await type('slug', 'new');
      await submit();
      const bold = page.querySelectorAll('#slug-error strong');
      expect(bold).toHaveLength(1);
      expect(bold[0]?.textContent).toBe('new');
      expect(bold[0]?.className).toBe('font-semibold');
      expect(error('slug')).toBe(ORGANIZATION_MESSAGES.slugInvalid);
    });

    it('a server-sent format message prints new in bold too', async () => {
      await type('name', NAME);
      await submit();
      convex.calls[0]?.reject(
        new ConvexError({
          field: 'slug',
          code: 'slugInvalid',
          message: ORGANIZATION_MESSAGES.slugInvalid,
        }),
      );
      await flush();
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('new');
    });

    it.each(['ab', 'Bad-Slug', 'a--b', '-ab', 'new', 'gulf-coast-sport-social', 'a'.repeat(61)])(
      'the slug %s gets the format message',
      async (slug) => {
        await type('name', NAME);
        await type('slug', slug);
        await submit();
        expect(error('slug')).toBe(ORGANIZATION_MESSAGES.slugInvalid);
        expect(convex.calls).toEqual([]);
      },
    );

    it('an error clears once its field is valid, and is not shown again while typing', async () => {
      await submit();
      await type('name', NAME);
      expect(error('name')).toBeNull();
      expect(input('name').hasAttribute('aria-invalid')).toBe(false);
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description');
      await type('name', '');
      expect(error('name')).toBeNull();
    });
  });

  describe('submitting (mockup state 11)', () => {
    beforeEach(() => open());

    it('sends the trimmed name and the slug, and lands on the admin Overview (#65)', async () => {
      await type('name', `  ${NAME} `);
      await submit();
      expect(convex.calls.map((c) => [c.kind, c.name, c.args])).toEqual([
        ['mutation', CREATE, { name: NAME, slug: SLUG }],
      ]);
      convex.calls[0]?.resolve({ slug: SLUG });
      await flush();
      expect(url()).toBe(`/app/organizations/${SLUG}`);
    });

    it('replaces the create form in the history, so Back skips it', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      await type('name', NAME);
      await submit();
      convex.calls[0]?.resolve({ slug: SLUG });
      await flush();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(`/app/organizations/${SLUG}`, {
        replaceUrl: true,
      });
    });

    it('sends a slug edited by hand, as typed', async () => {
      await type('name', NAME);
      await type('slug', 'abc');
      await submit();
      expect(convex.calls[0]?.args).toEqual({ name: NAME, slug: 'abc' });
    });

    it('while in flight: "Creating organization…", aria-disabled, a polite status, and a second press sends nothing', async () => {
      await type('name', NAME);
      await submit();
      expect(submitButton().textContent?.trim()).toBe('Creating organization…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(status()?.textContent?.trim()).toBe('Creating the organization.');
      expect(status()?.getAttribute('role')).toBe('status');
      await submit();
      expect(convex.calls).toHaveLength(1);
      // The values stay while in flight.
      expect(input('name').value).toBe(NAME);
    });

    it('after a failure the button is back to "Create organization", not aria-disabled', async () => {
      await type('name', NAME);
      await submit();
      convex.calls[0]?.reject(new Error('boom'));
      await flush();
      expect(submitButton().textContent?.trim()).toBe('Create organization');
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
      expect(status()?.textContent?.trim()).toBe('');
    });
  });

  describe('server answers (mockup states 10 and 12)', () => {
    beforeEach(() => open());

    it('slug taken: the approved message repeats the slug, focus on Slug, values kept; cleared by editing', async () => {
      await type('name', NAME);
      await submit();
      convex.calls[0]?.reject(
        new ConvexError({
          field: 'slug',
          code: 'slugTaken',
          message: ORGANIZATION_MESSAGES.slugTaken(SLUG),
        }),
      );
      await flush();
      expect(error('slug')).toBe(`${SLUG} is already taken. Choose another slug.`);
      expect(page.querySelector('#slug-error strong')?.textContent).toBe(SLUG);
      expect(input('slug').getAttribute('aria-invalid')).toBe('true');
      expect(input('slug').getAttribute('aria-describedby')).toBe('slug-description slug-error');
      expect(document.activeElement).toBe(input('slug'));
      expect(input('slug').value).toBe(SLUG);
      expect(input('name').value).toBe(NAME);
      expect(url()).toBe('/app/organizations/new');
      expect(alert()).toBeNull();
      await type('slug', `${SLUG}-2`);
      expect(error('slug')).toBeNull();
    });

    it('the server refusing a field the client let through shows its message on that field', async () => {
      await type('name', NAME);
      await submit();
      convex.calls[0]?.reject(
        new ConvexError({
          field: 'slug',
          code: 'slugInvalid',
          message: ORGANIZATION_MESSAGES.slugInvalid,
        }),
      );
      await flush();
      expect(error('slug')).toBe(ORGANIZATION_MESSAGES.slugInvalid);
      expect(document.activeElement).toBe(input('slug'));
      await submit();
      convex.calls[1]?.reject(
        new ConvexError({
          field: 'name',
          code: 'nameEmpty',
          message: ORGANIZATION_MESSAGES.nameEmpty,
        }),
      );
      await flush();
      expect(error('name')).toBe(ORGANIZATION_MESSAGES.nameEmpty);
      expect(document.activeElement).toBe(input('name'));
    });

    it.each([
      ['a network failure', new Error('Connection lost')],
      ['a ConvexError that is not about a field', new ConvexError('Sign in required')],
      ['a ConvexError with other data', new ConvexError({ field: 'other', message: 'x' })],
    ])('%s: the form alert takes focus, values stay', async (_name, failure) => {
      await type('name', NAME);
      await submit();
      convex.calls[0]?.reject(failure);
      await flush();
      const box = alert();
      expect(box?.getAttribute('role')).toBe('alert');
      expect(box?.getAttribute('tabindex')).toBe('-1');
      expect(box?.querySelector('[data-slot="alert-title"]')?.textContent?.trim()).toBe(
        'The organization could not be created.',
      );
      expect(box?.querySelector('[data-slot="alert-description"]')?.textContent?.trim()).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(box);
      expect(input('name').value).toBe(NAME);
      expect(input('slug').value).toBe(SLUG);
      expect(box?.textContent).not.toContain('Connection lost');
      // A later press clears the alert.
      await submit();
      expect(alert()).toBeNull();
    });
  });

  describe('offline (design/mockups/88-offline-note.html states 2 and 3)', () => {
    beforeEach(() => open());
    afterEach(() => vi.restoreAllMocks());

    const stubOnLine = (value: boolean) =>
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);

    const goOffline = async () => {
      stubOnLine(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await harness.fixture.whenStable();
    };

    it('while offline the submit button looks disabled but stays focusable', async () => {
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
      expect(submitButton().classList.contains('opacity-50')).toBe(false);
      await goOffline();
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().classList.contains('opacity-50')).toBe(true);
      expect(submitButton().hasAttribute('disabled')).toBe(false);
      expect(submitButton().textContent?.trim()).toBe('Create organization');
      submitButton().focus();
      expect(document.activeElement).toBe(submitButton());
    });

    it('pressing it shows the offline alert with focus, sends nothing, and keeps the values', async () => {
      await type('name', NAME);
      await goOffline();
      await submit();
      expect(convex.calls).toEqual([]);
      const box = alert();
      expect(box?.querySelector('[data-slot="alert-title"]')?.textContent?.trim()).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(box?.querySelector('[data-slot="alert-description"]')?.textContent?.trim()).toBe(
        "Your details are still here. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(box);
      expect(input('name').value).toBe(NAME);
      expect(input('slug').value).toBe(SLUG);
      expect(status()?.textContent?.trim()).toBe('');
    });

    it('a change refused by the adapter before the note appears shows the same alert', async () => {
      await type('name', NAME);
      // The socket is down, but the 5-second signal has not turned `online` false yet.
      convex.setConnected(false);
      vi.useFakeTimers();
      try {
        submitButton().click();
        await vi.advanceTimersByTimeAsync(3_100);
      } finally {
        vi.useRealTimers();
      }
      await flush();
      expect(convex.calls).toEqual([]);
      expect(alert()?.querySelector('[data-slot="alert-title"]')?.textContent?.trim()).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(document.activeElement).toBe(alert());
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
    });

    it('validation comes first: an empty form offline shows the field errors, not the alert', async () => {
      await goOffline();
      await submit();
      expect(error('name')).toBe(ORGANIZATION_MESSAGES.nameEmpty);
      expect(alert()).toBeNull();
    });
  });
});
