import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ConvexError } from 'convex/values';
import { LEAGUE_MESSAGES } from '../../../../convex/lib/leagueInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { AdminArea } from './admin-area';
import { AdminLeagues } from './admin-leagues';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { STICKY_FOOTER_CLEARANCE } from './sticky-footer';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  openAdmin,
  text,
  expectPageAndShellSubscriptions,
} from './testing/admin-harness';
import { expectStickyFooterWithFocusFix } from './testing/sticky-footer-check';

const ROUTES = adminRoutes(AdminArea, [{ path: 'leagues', component: AdminLeagues }]);
const URL = `/app/organizations/${COASTAL.slug}/leagues`;
const LIST_LEAGUES = 'leagues:listForAdmin';
const CREATE = 'leagues:create';
const tokens = (value: string) => value.split(' ').sort();

const LEAGUES = [
  {
    leagueId: 'lg_7v7',
    name: 'Coed 7v7 Rec',
    slug: 'coed-7v7-rec',
    sportName: 'Soccer',
    status: 'published',
    locationNames: ['Redfish Flats Fields'],
  },
  {
    leagueId: 'lg_4s',
    name: 'Sunday Reverse Coed 4s',
    slug: 'sunday-reverse-coed-4s',
    sportName: 'Beach volleyball',
    status: 'draft',
    locationNames: ['Pelican Shoals Sand Courts'],
  },
  {
    leagueId: 'lg_slow',
    name: 'Wednesday Coed Slow-Pitch',
    slug: 'wednesday-coed-slow-pitch',
    sportName: 'Softball',
    status: 'draft',
    locationNames: ['Tern Point Softball Complex', 'Redfish Flats Fields'],
  },
];

describe('AdminLeagues', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(leagues?: unknown[], locations: unknown[] | null = COASTAL_LOCATIONS) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (leagues) o.subscription(LIST_LEAGUES)!.emit(leagues);
    if (locations) o.subscription(LIST_FOR_ADMIN)!.emit(locations);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-league form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const formStatus = () => form().querySelector('p[role="status"].sr-only');
  const items = () => [...page.querySelectorAll<HTMLElement>('#leagues-list > li')];
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const sport = (key: string) => input(`sport-${key}`);
  const location = (n: number) => page.querySelector<HTMLButtonElement>(`#location-${n}`)!;

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function chooseSport(key: string) {
    const radio = sport(key);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function chooseFormat(count: number) {
    const radio = input(`format-${count}`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function toggleLocation(n: number) {
    location(n).click();
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await type('name', 'Sunday Reverse Coed 4s');
    await chooseSport('beachVolleyball');
    await chooseFormat(4);
    await toggleLocation(1);
  }

  describe('the page (states 1 to 3)', () => {
    it('asks leagues.listForAdmin and locations.listForAdmin with the organization id, only after the context says ready', async () => {
      await open();
      expectPageAndShellSubscriptions(o.convex, [
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [LIST_LEAGUES, { organizationId: COASTAL.organizationId }],
        [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Leagues');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'Drafts are visible only to your staff. Publish a league to put it on your public page.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Leagues | Coastal Bend Rec Club | Omni League',
      );
    });

    it('loading: placeholder rows and a polite status, with the create panel already there', async () => {
      await open(undefined, null);
      const panel = page.querySelector('section[aria-labelledby="leagues-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the leagues.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expect(text(page.querySelector('#create-league h2'))).toBe('Create a league');
      expect(page.querySelector('#create-league form')).toBeNull();
    });

    it('none yet (state 2): the empty state', async () => {
      await open([]);
      const panel = page.querySelector('section[aria-labelledby="leagues-heading"]')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('No leagues yet');
      expect(text(panel)).toContain(
        'Leagues you create appear here as drafts until you publish them.',
      );
      expect(panel.querySelector('ul')).toBeNull();
    });

    it('populated (state 3): a row per league with name, status, sport, and locations, and a Publish button on each draft only', async () => {
      await open(LEAGUES);
      expect(items().map((li) => text(li.querySelector('h3')))).toEqual(LEAGUES.map((l) => l.name));
      const badges = (li: HTMLElement) =>
        [...li.querySelectorAll('[data-slot="badge"]')].map((b) => [
          b.getAttribute('data-variant'),
          text(b),
        ]);
      expect(badges(items()[0])).toEqual([
        ['default', 'Published'],
        ['secondary', 'Soccer'],
      ]);
      expect(badges(items()[1])).toEqual([
        ['outline', 'Draft'],
        ['secondary', 'Beach volleyball'],
      ]);
      expect(text(items()[0].querySelector('p'))).toBe('Location: Redfish Flats Fields');
      expect(text(items()[2].querySelector('p'))).toBe(
        'Locations: Tern Point Softball Complex, Redfish Flats Fields',
      );
      expect(items()[0].querySelector('.sr-only')?.textContent).toBe('Location: ');
      expect(items().map((li) => li.querySelector('button') !== null)).toEqual([false, true, true]);
    });

    it('links each league’s name to its management page', async () => {
      await open(LEAGUES);
      const links = items().map((li) => li.querySelector<HTMLAnchorElement>('h3 a')!);
      expect(links.map((a) => [text(a), a.getAttribute('href')])).toEqual(
        LEAGUES.map((l) => [l.name, `/app/organizations/${COASTAL.slug}/leagues/${l.slug}`]),
      );
      expect(tokens(links[0].className)).toEqual(
        tokens(
          'inline-block underline underline-offset-4 hover:text-primary pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center',
        ),
      );
      expect(items()[1].querySelectorAll('button')).toHaveLength(1);
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open(undefined, COASTAL_LOCATIONS);
      o.subscription(LIST_LEAGUES)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector('section[aria-labelledby="leagues-heading"] [role="alert"]');
      expect(text(alert)).toBe(
        'The leagues could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a league created elsewhere at once (the list is live)', async () => {
      await open(LEAGUES.slice(0, 1));
      o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
      await o.flush();
      expect(items()).toHaveLength(3);
    });
  });

  describe('no locations (state 1)', () => {
    it('replaces the form with "Add a location first" and a link to Locations, and still lists the leagues', async () => {
      await open(LEAGUES, []);
      const panel = page.querySelector('#create-league')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('Add a location first');
      expect(text(panel)).toContain('Every league is held at one or more of your locations.');
      const link = panel.querySelector<HTMLAnchorElement>('a')!;
      expect(text(link)).toBe('Go to Locations');
      expect(link.getAttribute('href')).toBe(`/app/organizations/${COASTAL.slug}/locations`);
      expect(link.getAttribute('data-slot')).toBe('button');
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(page.querySelector('form')).toBeNull();
      expect(items()).toHaveLength(3);
    });

    it('the form appears when the first location arrives', async () => {
      await open([], []);
      expect(page.querySelector('#create-league form')).toBeNull();
      o.subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS);
      await o.flush();
      expect(page.querySelector('#create-league form')).not.toBeNull();
    });
  });

  describe('the "Create a league" jump link (phones)', () => {
    it('is hidden from 1024px, targets the form, and moves focus and scroll to it', async () => {
      await open([]);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Create a league');
      expect(link.getAttribute('href')).toBe(`${URL}#create-league`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      expect(tokens(link.className.replace(' lg:hidden', ''))).toEqual(tokens(OUTLINE_BUTTON));
      const section = page.querySelector<HTMLElement>('#create-league')!;
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await o.flush();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input('name'));
    });

    describe('with the scroll recorded', () => {
      let scrolled: Element[];
      const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

      beforeEach(() => {
        scrolled = [];
        Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
          scrolled.push(this);
        });
      });

      afterEach(() => {
        if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
        else delete (Element.prototype as Partial<Element>).scrollIntoView;
        vi.restoreAllMocks();
      });

      const jumpLink = () => page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      const section = () => page.querySelector<HTMLElement>('#create-league')!;
      const skeleton = () => section().querySelector('[data-slot="create-league-skeleton"]');
      const loadingStatus = () => text(section().querySelector('p[role="status"].sr-only'));
      const goToLocations = () => section().querySelector<HTMLAnchorElement>('a[href]')!;
      const locationsAlert = () => section().querySelector<HTMLElement>('[data-slot="alert"]')!;

      async function pressAsChromium() {
        jumpLink().focus();
        jumpLink().click();
        await o.flush();
      }

      async function tapAsWebKit() {
        jumpLink().click();
        await o.flush();
      }

      async function locationsArrive(locations: unknown[] = COASTAL_LOCATIONS) {
        o.subscription(LIST_FOR_ADMIN)!.emit(locations);
        await o.flush();
      }

      describe('pressed while the locations load', () => {
        it('at once scrolls to the section and focuses it, then focuses Name and brings it into view once the form renders', async () => {
          await open([], null);
          expect(section().getAttribute('tabindex')).toBe('-1');
          expect(tokens(section().className)).toContain('focus:outline-none');
          await pressAsChromium();
          expect(scrolled).toEqual([section()]);
          expect(document.activeElement).toBe(section());
          await locationsArrive();
          expect(document.activeElement).toBe(input('name'));
          expect(scrolled).toEqual([section(), input('name')]);
        });

        it('a tap that leaves the link unfocused (WebKit) still ends on Name', async () => {
          await open([], null);
          await tapAsWebKit();
          expect(document.activeElement).toBe(section());
          await locationsArrive();
          expect(document.activeElement).toBe(input('name'));
        });

        it('a later focus elsewhere cancels the jump: the form’s arrival moves no focus', async () => {
          await open(LEAGUES, null);
          await pressAsChromium();
          const leagueLink = items()[0].querySelector<HTMLAnchorElement>('h3 a')!;
          leagueLink.focus();
          await locationsArrive();
          expect(document.activeElement).toBe(leagueLink);
          expect(scrolled).toEqual([section()]);
        });

        for (const shiftKey of [false, true]) {
          it(`a ${shiftKey ? 'Shift+Tab' : 'Tab'} keydown cancels the jump, as Shift+Tab out of the page fires no focusin in WebKit`, async () => {
            await open([], null);
            await pressAsChromium();
            section().dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }),
            );
            await locationsArrive();
            expect(document.activeElement).toBe(section());
            expect(scrolled).toEqual([section()]);
          });
        }

        it('the window losing focus (a focusout to nothing, with no key) keeps the jump', async () => {
          await open([], null);
          await pressAsChromium();
          section().dispatchEvent(
            new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
          );
          await locationsArrive();
          expect(document.activeElement).toBe(input('name'));
        });

        it('a later press on a link that takes no focus cancels the jump', async () => {
          await open(LEAGUES, null);
          const router = TestBed.inject(Router);
          const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
          await pressAsChromium();
          items()[0].querySelector<HTMLAnchorElement>('h3 a')!.click();
          await o.flush();
          expect(navigate).toHaveBeenCalledTimes(1);
          await locationsArrive();
          expect(document.activeElement).toBe(section());
          expect(scrolled).toEqual([section()]);
        });

        for (const [name, scroll] of [
          ['the wheel', () => page.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))],
          ['a touch scroll', () => page.dispatchEvent(new Event('touchmove', { bubbles: true }))],
          [
            'Page Down',
            () =>
              section().dispatchEvent(
                new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }),
              ),
          ],
        ] as const) {
          it(`a user scroll by ${name} cancels the jump: the form’s arrival moves neither focus nor scroll`, async () => {
            await open([], null);
            await pressAsChromium();
            scroll();
            await locationsArrive();
            expect(document.activeElement).toBe(section());
            expect(scrolled).toEqual([section()]);
          });
        }

        for (const key of [
          ' ',
          'PageUp',
          'Home',
          'End',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ]) {
          it(`the scroll key "${key}" cancels the jump`, async () => {
            await open([], null);
            await pressAsChromium();
            section().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            await locationsArrive();
            expect(document.activeElement).toBe(section());
            expect(scrolled).toEqual([section()]);
          });
        }

        it('a key that does not scroll keeps the jump', async () => {
          await open([], null);
          await pressAsChromium();
          section().dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
          await locationsArrive();
          expect(document.activeElement).toBe(input('name'));
        });

        it('no locations arriving focuses "Go to Locations"', async () => {
          await open([], null);
          await pressAsChromium();
          await locationsArrive([]);
          expect(text(goToLocations())).toBe('Go to Locations');
          expect(document.activeElement).toBe(goToLocations());
        });

        it('a failed query focuses the alert', async () => {
          await open([], null);
          await pressAsChromium();
          o.subscription(LIST_FOR_ADMIN)!.fail(new Error('Server Error'));
          await o.flush();
          expect(text(locationsAlert())).toBe(
            'The locations could not be loaded. Check your connection and try again.',
          );
          expect(document.activeElement).toBe(locationsAlert());
        });

        it('offline, the status and skeleton stay and nothing moves focus; on reconnect the form’s arrival focuses Name', async () => {
          await open([], null);
          await pressAsChromium();
          const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
          window.dispatchEvent(new Event('offline'));
          await o.flush();
          expect(loadingStatus()).toBe('Loading the locations.');
          expect(skeleton()).not.toBeNull();
          expect(document.activeElement).toBe(section());
          onLine.mockReturnValue(true);
          window.dispatchEvent(new Event('online'));
          await locationsArrive();
          expect(document.activeElement).toBe(input('name'));
        });

        it('offline, a user scroll before reconnect cancels the jump: the form’s arrival moves neither focus nor scroll', async () => {
          await open([], null);
          await pressAsChromium();
          const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
          window.dispatchEvent(new Event('offline'));
          await o.flush();
          page.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
          onLine.mockReturnValue(true);
          window.dispatchEvent(new Event('online'));
          await locationsArrive();
          expect(document.activeElement).toBe(section());
          expect(scrolled).toEqual([section()]);
        });

        it('pressed again, the jump still ends on Name', async () => {
          await open([], null);
          await pressAsChromium();
          await pressAsChromium();
          await locationsArrive();
          expect(document.activeElement).toBe(input('name'));
        });
      });

      describe('pressed once the locations are in', () => {
        it('none: scrolls to the section and focuses "Go to Locations"', async () => {
          await open([], []);
          await pressAsChromium();
          expect(scrolled).toEqual([section()]);
          expect(document.activeElement).toBe(goToLocations());
        });

        it('failed: scrolls to the section and focuses the alert', async () => {
          await open([], null);
          o.subscription(LIST_FOR_ADMIN)!.fail(new Error('Server Error'));
          await o.flush();
          await pressAsChromium();
          expect(scrolled).toEqual([section()]);
          expect(document.activeElement).toBe(locationsAlert());
        });
      });

      it('the skeleton comes out one render after the content goes in, with a layout in between (WebKit keeps the scroll)', async () => {
        await open([], null);
        const order: string[] = [];
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof Element && node.matches('app-league-create-form')) {
                order.push('form in');
              }
            }
            for (const node of record.removedNodes) {
              if (node instanceof Element && node.matches('[data-slot="create-league-skeleton"]')) {
                order.push('skeleton out');
              }
            }
          }
        });
        observer.observe(section(), { childList: true });
        const layouts: boolean[] = [];
        const measure = section().getBoundingClientRect.bind(section());
        vi.spyOn(section(), 'getBoundingClientRect').mockImplementation(() => {
          layouts.push(!!section().querySelector('form') && !!skeleton());
          return measure();
        });
        await locationsArrive();
        observer.disconnect();
        expect(order).toEqual(['form in', 'skeleton out']);
        expect(layouts).toContain(true);
      });

      it('while the locations load, a skeleton shaped like the form stands in, hidden from screen readers, beside the status', async () => {
        await open([], null);
        expect(loadingStatus()).toBe('Loading the locations.');
        const shown = skeleton()!;
        expect(shown.getAttribute('aria-hidden')).toBe('true');
        const pulses = shown.querySelectorAll('.bg-muted.motion-safe\\:animate-pulse');
        expect(pulses.length).toBeGreaterThan(0);
        expect(shown.querySelectorAll('[data-slot="skeleton-input"]')).toHaveLength(2);
        expect(shown.querySelectorAll('[data-slot="skeleton-chip"]').length).toBeGreaterThan(0);
        expect(shown.querySelectorAll('[data-slot="skeleton-location"]')).toHaveLength(1);
        await locationsArrive();
        expect(skeleton()).toBeNull();
        expect(text(section())).not.toContain('Loading the locations.');
      });
    });
  });

  describe('the sticky footer', () => {
    it('holds the submit button in the shared sticky footer, below the fields, and the card clips instead of hiding overflow', async () => {
      await open([]);
      const footer = submitButton().parentElement!;
      expect(footer.getAttribute('data-slot')).toBe('form-footer');
      expect(tokens(footer.className)).toEqual(expect.arrayContaining(['sticky', 'bottom-0']));
      expect(footer.parentElement).toBe(form());
      expect(
        form().querySelector('[data-slot="field-group"]')!.compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // `overflow-hidden` would make the card the footer's scroll container, so it never sticks.
      const card = page.querySelector('#create-league')!;
      expect(tokens(card.className)).toContain('overflow-clip');
      expect(tokens(card.className)).not.toContain('overflow-hidden');
    });

    it('keeps its fields clear of the footer when they take focus (WCAG 2.4.11)', async () => {
      await open([]);
      const group = form().querySelector('[data-slot="field-group"]')!;
      expect(tokens(group.className)).toEqual(
        expect.arrayContaining(tokens(STICKY_FOOTER_CLEARANCE)),
      );
    });

    it('brings a focused field back above the footer when an error pushes it down (WCAG 2.4.11)', async () => {
      await open([]);
      expectStickyFooterWithFocusFix(o.harness.fixture.debugElement, form());
    });
  });

  describe('one location', () => {
    const ONLY = [COASTAL_LOCATIONS[0]];

    it('shows the only location checked, so a valid form needs no tick', async () => {
      await open([], ONLY);
      expect(location(1).getAttribute('aria-checked')).toBe('true');
      await type('name', 'Sunday Reverse Coed 4s');
      await chooseSport('beachVolleyball');
      await chooseFormat(4);
      await submit();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            name: 'Sunday Reverse Coed 4s',
            slug: 'sunday-reverse-coed-4s',
            sport: 'beachVolleyball',
            locationIds: ['loc_pelican'],
            gender: 'coed',
            playersPerSide: 4,
            level: 'rec',
            ageGroup: 'adult',
          },
        ],
      ]);
    });

    it('checks it again after a successful create', async () => {
      await open([], ONLY);
      await type('name', 'Sunday Reverse Coed 4s');
      await chooseSport('beachVolleyball');
      await chooseFormat(4);
      await submit();
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
      expect(input('name').value).toBe('');
      expect(location(1).getAttribute('aria-checked')).toBe('true');
    });

    it('keeps a location the user unchecked unchecked, and refuses a submit without one', async () => {
      await open([], ONLY);
      await toggleLocation(1);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
      await type('name', 'Sunday Reverse Coed 4s');
      await chooseSport('beachVolleyball');
      await chooseFormat(4);
      await submit();
      expect(o.convex.calls).toHaveLength(0);
      expect(error('locations')).toBe('Choose at least one location.');
    });

    it('with two or more locations none is checked, after a create too', async () => {
      await open([], COASTAL_LOCATIONS);
      expect(
        [...page.querySelectorAll('[role="checkbox"]')].map((b) => b.getAttribute('aria-checked')),
      ).toEqual(['false', 'false', 'false']);
      await fill();
      await submit();
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
      expect(location(1).getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('the form (states 4 to 8)', () => {
    it('is a labelled section and form with the mockup attributes', async () => {
      await open([]);
      const section = page.querySelector('#create-league')!;
      expect(section.tagName).toBe('SECTION');
      expect(section.getAttribute('aria-labelledby')).toBe('create-league-heading');
      expect(form().getAttribute('aria-labelledby')).toBe('create-league-heading');
      expect(form().getAttribute('aria-describedby')).toBe('create-league-note');
      expect(form().hasAttribute('novalidate')).toBe(true);
      expect(text(page.querySelector('#create-league-note'))).toBe(
        'New leagues start as drafts, which only your staff see.',
      );
      expect(text(page.querySelector('label[for="name"]'))).toBe('Name');
      expect(text(page.querySelector('label[for="slug"]'))).toBe('Slug');
      for (const id of ['name', 'slug']) {
        const field = input(id);
        expect([field.type, field.required, field.getAttribute('autocomplete')]).toEqual([
          'text',
          true,
          'off',
        ]);
        expect(field.getAttribute('aria-describedby')).toBe(`${id}-description`);
      }
      expect(text(page.querySelector('#name-description'))).toBe(
        'The name players know it by every season, such as Sunday Coed 4s. Up to 100 characters.',
      );
      expect(text(page.querySelector('#slug-description'))).toBe(
        '3 to 60 lowercase letters and digits, with single hyphens between them. Unique within Coastal Bend Rec Club.',
      );
      expect(text(submitButton())).toBe('Create draft league');
      expect(tokens(submitButton().className)).toEqual(tokens(`${PRIMARY_BUTTON} w-full`));
      expect(text(formStatus())).toBe('');
    });

    it('Sport is a fieldset with a legend and three chip radios in sport order, none chosen', async () => {
      await open([]);
      const set = page.querySelector<HTMLFieldSetElement>('fieldset#sport')!;
      expect(text(set.querySelector('legend'))).toBe('Sport');
      const radios = [...set.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((r) => [r.id, r.name, r.value, r.checked])).toEqual([
        ['sport-beachVolleyball', 'sport', 'beachVolleyball', false],
        ['sport-soccer', 'sport', 'soccer', false],
        ['sport-softball', 'sport', 'softball', false],
      ]);
      expect(radios.map((r) => text(page.querySelector(`label[for="${r.id}"]`)))).toEqual([
        'Beach volleyball',
        'Soccer',
        'Softball',
      ]);
    });

    it('Locations is a fieldset with a legend, a description, and a checkbox per location', async () => {
      await open([]);
      const set = page.querySelector<HTMLFieldSetElement>('fieldset#locations')!;
      expect(text(set.querySelector('legend'))).toBe('Locations');
      expect(text(set.querySelector('#locations-description'))).toBe('Choose one or more.');
      expect(set.getAttribute('aria-describedby')).toBe('locations-description');
      const boxes = [...set.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(boxes.map((b) => [b.id, b.getAttribute('aria-checked')])).toEqual([
        ['location-1', 'false'],
        ['location-2', 'false'],
        ['location-3', 'false'],
      ]);
      expect(boxes.map((b) => text(page.querySelector(`label[for="${b.id}"]`)))).toEqual(
        COASTAL_LOCATIONS.map((l) => l.name),
      );
    });

    it('typing a name fills Slug with slugify(name) until Slug is edited', async () => {
      await open([]);
      await type('name', 'Sunday Reverse Coed 4s');
      expect(input('slug').value).toBe('sunday-reverse-coed-4s');
      await type('name', "Men's D Division");
      expect(input('slug').value).toBe('men-s-d-division');
      await type('name', '   ');
      expect(input('slug').value).toBe('');
      await type('slug', 'my-own');
      await type('name', 'Something else');
      expect(input('slug').value).toBe('my-own');
    });

    it('submitted empty (state 5): every message, aria attributes, focus on Name, nothing sent', async () => {
      await open([]);
      await submit();
      expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
      expect(error('slug')).toBe(LEAGUE_MESSAGES.slugEmpty);
      expect(error('sport')).toBe('Choose a sport.');
      expect(error('locations')).toBe('Choose at least one location.');
      for (const id of ['name', 'slug']) {
        expect(input(id).getAttribute('aria-invalid')).toBe('true');
        expect(input(id).getAttribute('aria-describedby')).toBe(`${id}-description ${id}-error`);
      }
      expect(page.querySelector('fieldset#sport')?.getAttribute('aria-describedby')).toBe(
        'sport-description sport-error',
      );
      expect(page.querySelector('fieldset#locations')?.getAttribute('aria-describedby')).toBe(
        'locations-description locations-error',
      );
      expect(page.querySelector('#sport-error')?.getAttribute('role')).toBe('alert');
      expect(page.querySelector('#locations-error')?.getAttribute('role')).toBe('alert');
      expect(sport('soccer').getAttribute('aria-invalid')).toBe('true');
      expect(location(1).getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('name'));
      expect(calls()).toEqual([]);
    });

    it('focus goes to the first invalid field: Slug, then the first sport, then the first format, then the first location', async () => {
      await open([]);
      await type('name', 'Fine');
      await type('slug', '');
      await submit();
      expect(document.activeElement).toBe(input('slug'));
      await type('slug', 'fine');
      await submit();
      expect(error('slug')).toBeNull();
      expect(document.activeElement).toBe(sport('beachVolleyball'));
      await chooseSport('soccer');
      await submit();
      expect(error('sport')).toBeNull();
      expect(document.activeElement).toBe(input('format-4'));
      await chooseFormat(7);
      await submit();
      expect(error('format')).toBeNull();
      expect(document.activeElement).toBe(location(1));
      expect(calls()).toEqual([]);
    });

    it('101 characters get the count message, and whitespace-only counts as empty', async () => {
      await open([]);
      await type('name', 'n'.repeat(101));
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
      await type('name', '   ');
      await submit();
      expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
    });

    it('an invalid slug shows the format message, the reserved word `new` in bold', async () => {
      await open([]);
      await fill();
      for (const slug of ['Bad Slug', 'ab', 'a'.repeat(61), 'new', '-x-', 'a--b']) {
        await type('slug', slug);
        await submit();
        expect(error('slug'), slug).toBe(LEAGUE_MESSAGES.slugInvalid);
        expect(document.activeElement).toBe(input('slug'));
      }
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('new');
      expect(calls()).toEqual([]);
    });

    it('an error clears once its field is valid', async () => {
      await open([]);
      await submit();
      await type('name', 'Fine');
      expect(error('name')).toBeNull();
      await chooseSport('softball');
      expect(error('sport')).toBeNull();
      await toggleLocation(2);
      expect(error('locations')).toBeNull();
      await toggleLocation(2);
      expect(error('locations')).toBeNull();
    });

    describe('checking a field when the user leaves it', () => {
      async function leave(id: string) {
        input(id).dispatchEvent(new Event('blur'));
        await o.harness.fixture.whenStable();
      }

      async function leaveLocations(n: number, to: HTMLElement | null) {
        location(n).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
        await o.harness.fixture.whenStable();
      }

      it('shows the error with aria-invalid and aria-describedby once a changed field is left', async () => {
        await open([]);
        await type('name', 'n'.repeat(101));
        await leave('name');
        expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
        expect(input('name').getAttribute('aria-invalid')).toBe('true');
        expect(input('name').getAttribute('aria-describedby')).toContain('name-error');
        await type('slug', 'Not-Valid');
        await leave('slug');
        expect(error('slug')).toBe(LEAGUE_MESSAGES.slugInvalid);
        expect(input('slug').getAttribute('aria-invalid')).toBe('true');
      });

      it('shows nothing while the user types an invalid partial value', async () => {
        await open([]);
        await type('slug', 'Not-Valid');
        expect(error('slug')).toBeNull();
        expect(input('slug').hasAttribute('aria-invalid')).toBe(false);
      });

      it('shows nothing when focus passes through a field that was never changed; a submit still shows it', async () => {
        await open([]);
        await leave('name');
        await leave('slug');
        await leaveLocations(1, null);
        expect(error('name')).toBeNull();
        expect(error('slug')).toBeNull();
        expect(error('locations')).toBeNull();
        await submit();
        expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
        expect(error('slug')).toBe(LEAGUE_MESSAGES.slugEmpty);
        expect(error('locations')).toBe(LEAGUE_MESSAGES.locationsEmpty);
      });

      it('clears the error on the keystroke that makes the value valid', async () => {
        await open([]);
        await type('slug', 'Not-Valid');
        await leave('slug');
        await type('slug', 'valid-slug');
        expect(error('slug')).toBeNull();
        expect(input('slug').hasAttribute('aria-invalid')).toBe(false);
      });

      it('checks a slug that followed the name when Slug is left', async () => {
        await open([]);
        await type('name', 'ab');
        await leave('slug');
        expect(error('slug')).toBe(LEAGUE_MESSAGES.slugInvalid);
      });

      it('checks the locations when focus leaves the group after a change, not while it moves within', async () => {
        await open([]);
        await toggleLocation(1);
        await toggleLocation(1);
        await leaveLocations(1, location(2));
        expect(error('locations')).toBeNull();
        await leaveLocations(2, null);
        expect(error('locations')).toBe(LEAGUE_MESSAGES.locationsEmpty);
        expect(page.querySelector('fieldset#locations')?.getAttribute('aria-describedby')).toBe(
          'locations-description locations-error',
        );
        await toggleLocation(3);
        expect(error('locations')).toBeNull();
      });

      it('a form emptied after a create starts again: passing through its fields shows nothing', async () => {
        await open([]);
        await fill();
        await submit();
        o.convex.calls[0]?.resolve({ leagueId: 'league_new' });
        await o.flush();
        expect(input('name').value).toBe('');
        await leave('name');
        await leave('slug');
        await leaveLocations(1, null);
        expect(error('name')).toBeNull();
        expect(error('slug')).toBeNull();
        expect(error('locations')).toBeNull();
      });
    });

    it('sends the trimmed name, the slug, the sport, and the chosen location ids; while in flight the button says so (state 7)', async () => {
      await open([]);
      await type('name', '  Sunday Reverse Coed 4s ');
      await chooseSport('beachVolleyball');
      await chooseFormat(4);
      await toggleLocation(3);
      await toggleLocation(1);
      await submit();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            name: 'Sunday Reverse Coed 4s',
            slug: 'sunday-reverse-coed-4s',
            sport: 'beachVolleyball',
            locationIds: ['loc_pelican', 'loc_tern'],
            gender: 'coed',
            playersPerSide: 4,
            level: 'rec',
            ageGroup: 'adult',
          },
        ],
      ]);
      expect(text(submitButton())).toBe('Creating league…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(text(formStatus())).toBe('Creating the league.');
      await submit();
      expect(o.convex.calls).toHaveLength(1);
    });

    const createdStatus = () => form().querySelector<HTMLElement>('[data-slot="created-status"]');

    async function created() {
      await fill();
      submitButton().focus();
      await submit();
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
    }

    it('on success (state 8): "<league> created as a draft." in the footer above the button, the form cleared, focus kept on the button', async () => {
      await open([]);
      await created();
      const status = createdStatus()!;
      expect(text(status.querySelector('[data-slot="created-title"]'))).toBe(
        'Sunday Reverse Coed 4s created as a draft.',
      );
      expect(text(status.querySelector('a'))).toBe('Add the first season');
      expect(text(form())).not.toContain('Publish it when');
      expect(status.parentElement!.getAttribute('data-slot')).toBe('form-footer');
      expect(status.nextElementSibling).toBe(submitButton());
      expect(input('name').value).toBe('');
      expect(input('slug').value).toBe('');
      expect(sport('beachVolleyball').checked).toBe(false);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Create draft league');
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
    });

    it('holds the whole name in the title, so the region announces it even where the title is clamped', async () => {
      await open([]);
      await created();
      const title = createdStatus()!.querySelector('[data-slot="created-title"]')!;
      expect(title.textContent).toBe('Sunday Reverse Coed 4s created as a draft.');
    });

    it('announces the result in one status region that was in the footer, empty, before the press, with no status inside another', async () => {
      await open([]);
      const region = createdStatus()!;
      expect(region.getAttribute('role')).toBe('status');
      expect(text(region)).toBe('');
      await created();
      expect(createdStatus()).toBe(region);
      const holding = [...form().querySelectorAll('[role="status"]')].filter((element) =>
        element.textContent.includes('created as a draft.'),
      );
      expect(holding).toEqual([region]);
      expect(form().querySelectorAll('[role="status"] [role="status"]')).toHaveLength(0);
    });

    it('clears the created status on the next edit of the cleared form', async () => {
      await open([]);
      await created();
      input('name').value = 'N';
      input('name').dispatchEvent(new Event('input', { bubbles: true }));
      await o.harness.fixture.whenStable();
      expect(text(createdStatus())).toBe('');
      expect(createdStatus()).not.toBeNull();
    });

    it('clears the created status when a location is ticked or unticked', async () => {
      await open([]);
      await created();
      await toggleLocation(2);
      expect(text(createdStatus())).toBe('');
    });

    it('clears the created status when the next create starts', async () => {
      await open([]);
      await created();
      await type('name', 'Next One');
      expect(input('slug').value).toBe('next-one');
      await chooseSport('beachVolleyball');
      await toggleLocation(1);
      await submit();
      expect(text(createdStatus())).toBe('');
    });

    it('the success status links "Add the first season" to the league’s management page, 44px tall on a touch screen', async () => {
      await open([]);
      await created();
      const link = createdStatus()!.querySelector<HTMLAnchorElement>('a')!;
      expect(text(link)).toBe('Add the first season');
      expect(link.getAttribute('href')).toBe(
        `/app/organizations/${COASTAL.slug}/leagues/sunday-reverse-coed-4s`,
      );
      expect(tokens(link.className)).toContain('pointer-coarse:min-h-11');
    });

    it('the link names the slug as sent, even after the fields were cleared', async () => {
      await open([]);
      await fill();
      await type('slug', 'sunday-4s');
      await submit();
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
      expect(createdStatus()!.querySelector('a')!.getAttribute('href')).toBe(
        `/app/organizations/${COASTAL.slug}/leagues/sunday-4s`,
      );
    });

    it('the server saying the slug is taken (state 6) shows the message with the slug in bold, and focus on Slug', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'slug',
          code: 'slugTaken',
          message: LEAGUE_MESSAGES.slugTaken('sunday-reverse-coed-4s'),
        }),
      );
      await o.flush();
      expect(error('slug')).toBe(
        'sunday-reverse-coed-4s is already used by another league here. Choose another slug.',
      );
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('sunday-reverse-coed-4s');
      expect(document.activeElement).toBe(input('slug'));
      expect(input('slug').getAttribute('aria-invalid')).toBe('true');
      expect(input('name').value).toBe('Sunday Reverse Coed 4s');
      await type('slug', 'sunday-reverse-coed-4s-b');
      expect(error('slug')).toBeNull();
    });

    it('any other failure shows the form alert and focuses it, keeping the values', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert)).toBe(
        'The league could not be created. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('name').value).toBe('Sunday Reverse Coed 4s');
      expect(text(submitButton())).toBe('Create draft league');
    });

    it('titles the failure alert with its heading above its description', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The league could not be created.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      async function goOffline() {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
      }

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await open([]);
        await fill();
        await goOffline();
        expect(submitButton().getAttribute('aria-disabled')).toBe('true');
        expect(submitButton().classList.contains('opacity-50')).toBe(true);
        expect(submitButton().hasAttribute('disabled')).toBe(false);
        await submit();
        expect(o.convex.calls).toEqual([]);
        const box = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
        expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was sent.",
        );
        expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(
          "Your details are still here. Try again when you're connected.",
        );
        expect(document.activeElement).toBe(box);
        expect(input('name').value).toBe('Sunday Reverse Coed 4s');
      });

      it('validation comes first: an empty form offline shows the field errors, not the alert', async () => {
        await open([]);
        await goOffline();
        await submit();
        expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
        expect(form().querySelector('[data-slot="alert"]')).toBeNull();
      });
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
      );
      expect(input('name').value).toBe('Sunday Reverse Coed 4s');
    });
  });
});
