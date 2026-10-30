import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { afterEach, vi } from 'vitest';
import { LOGO_HINT } from '../../../../convex/lib/logoFile';
import { ConvexOfflineError } from '../../core/data/convex';
import { AdminArea } from './admin-area';
import { AdminDetails } from './admin-details';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { adminRoutes, COASTAL, GET_ADMIN_CONTEXT, openAdmin, text } from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'details', component: AdminDetails }]);
const URL = `/app/organizations/${COASTAL.slug}/details`;
const UPLOAD_URL = 'organizations:generateLogoUploadUrl';
const SET_LOGO = 'organizations:setLogo';
const REMOVE_LOGO = 'organizations:removeLogo';
const LOGO_URL = 'https://example.convex.cloud/api/storage/current';
const POSTED_URL = 'https://example.convex.cloud/api/storage/upload?token=abc';
const STORAGE_ID = 'kg_new_logo';
const tokens = (value: string) => value.split(' ').sort();

const file = (type = 'image/png', size = 1024, name = 'logo.png') =>
  new File([new Uint8Array(size)], name, { type });

describe('AdminDetails: the Logo section', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function open(logoUrl?: string) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit({ ...COASTAL, ...(logoUrl && { logoUrl }) });
    await o.flush();
  }

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ storageId: STORAGE_ID }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const section = () => page.querySelector<HTMLElement>('section[aria-labelledby="logo-heading"]')!;
  const fileInput = () => section().querySelector<HTMLInputElement>('input#logo-file')!;
  const fileLabel = () => section().querySelector<HTMLElement>('label[for="logo-file"]')!;
  const removeButton = () => section().querySelector<HTMLButtonElement>('button#logo-remove');
  const status = () => section().querySelector<HTMLElement>('[data-slot="alert"][role="status"]');
  const failure = () => section().querySelector<HTMLElement>('[data-slot="alert"][role="alert"]');
  const fieldError = () => section().querySelector<HTMLElement>('#logo-error');
  const preview = () => section().querySelector<HTMLElement>('app-organization-mark')!;
  const srStatus = () => section().querySelector<HTMLElement>('p[role="status"].sr-only');
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;

  async function choose(chosen: File) {
    Object.defineProperty(fileInput(), 'files', { value: [chosen], configurable: true });
    fileInput().dispatchEvent(new Event('change'));
    await o.flush();
  }

  /** Lets the page's upload run to the point where it waits for the action. */
  async function uploadAcceptedFile(chosen = file()) {
    await choose(chosen);
    o.convex.calls[0].resolve(POSTED_URL);
    await o.flush();
  }

  describe('without a logo', () => {
    beforeEach(() => open());

    it('has a Logo heading, the initials mark at 48px, and the upload control', () => {
      expect(text(section().querySelector('h2'))).toBe('Logo');
      expect(text(preview())).toBe('CB');
      expect(preview().classList).toContain('size-12');
      expect(preview().querySelector('img')).toBeNull();
      expect(text(fileLabel())).toBe('Upload a logo');
      expect(removeButton()).toBeNull();
    });

    it('labels the file input, accepts PNG, JPEG, and WebP, and describes it with the hint', () => {
      expect(fileInput().type).toBe('file');
      expect(fileInput().accept).toBe('image/png,image/jpeg,image/webp');
      expect(fileInput().getAttribute('aria-describedby')).toBe('logo-hint');
      expect(text(section().querySelector('#logo-hint'))).toBe(LOGO_HINT);
      expect(LOGO_HINT).toBe('Square images work best. PNG, JPEG, or WebP, up to 256 KB.');
      expect(fieldError()).toBeNull();
      expect(status()).toBeNull();
    });

    it('draws the label as a primary button with the file input beside it for the keyboard', () => {
      expect(fileLabel().getAttribute('data-slot')).toBe('button');
      expect(tokens(fileLabel().className)).toEqual(expect.arrayContaining(tokens(PRIMARY_BUTTON)));
      expect(fileInput().classList).toContain('sr-only');
      expect(fileInput().tabIndex).not.toBe(-1);
    });

    it('sends nothing for a file of the wrong type, and shows the message under the field', async () => {
      await choose(file('image/svg+xml', 1024, 'logo.svg'));
      expect(o.convex.calls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(text(fieldError())).toBe('Use a PNG, JPEG, or WebP image.');
      expect(fieldError()?.getAttribute('role')).toBe('alert');
      expect(fileInput().getAttribute('aria-describedby')).toBe('logo-hint logo-error');
      expect(fileInput().getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(fileInput());
    });

    it('sends nothing for a file over 256 KB, and says how large it is', async () => {
      await choose(file('image/png', 1_258_291));
      expect(o.convex.calls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(text(fieldError())).toBe('Use an image of 256 KB or less. This one is 1.2 MB.');
    });

    it('clears the error when a valid file is chosen', async () => {
      await choose(file('image/gif'));
      expect(fieldError()).not.toBeNull();
      await choose(file());
      expect(fieldError()).toBeNull();
      expect(fileInput().hasAttribute('aria-invalid')).toBe(false);
    });

    it('asks for an upload URL for the organization, posts the file to it, then sets the logo', async () => {
      const chosen = file('image/webp', 2048, 'logo.webp');
      await choose(chosen);
      expect(o.convex.calls.map((c) => [c.kind, c.name, c.args])).toEqual([
        ['mutation', UPLOAD_URL, { organizationId: COASTAL.organizationId }],
      ]);
      o.convex.calls[0].resolve(POSTED_URL);
      await o.flush();
      expect(fetchMock).toHaveBeenCalledWith(POSTED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: chosen,
      });
      expect(o.convex.calls.map((c) => [c.kind, c.name, c.args])[1]).toEqual([
        'action',
        SET_LOGO,
        { organizationId: COASTAL.organizationId, storageId: STORAGE_ID },
      ]);
    });

    it('while uploading: "Uploading…", aria-disabled, a polite status, and a second file sends nothing', async () => {
      await choose(file());
      expect(text(fileLabel())).toBe('Uploading…');
      expect(fileLabel().getAttribute('aria-disabled')).toBe('true');
      expect(text(srStatus())).toBe('Uploading the logo.');
      await choose(file());
      expect(o.convex.calls).toHaveLength(1);
    });

    it('on success: "Logo saved." in a status that takes focus, and the new mark once the query answers', async () => {
      await uploadAcceptedFile();
      o.convex.calls[1].resolve(null);
      o.subscription(GET_ADMIN_CONTEXT)!.emit({ ...COASTAL, logoUrl: LOGO_URL });
      await o.flush();
      expect(text(status()?.querySelector('[data-slot="alert-title"]'))).toBe('Logo saved.');
      expect(document.activeElement).toBe(status());
      expect(preview().querySelector('img')?.getAttribute('src')).toBe(LOGO_URL);
      expect(text(fileLabel())).toBe('Replace logo');
      expect(removeButton()).not.toBeNull();
    });

    it('shows the server’s message under the field, focuses it, and keeps the mark', async () => {
      const message = 'Use a PNG, JPEG, or WebP image.';
      await uploadAcceptedFile();
      o.convex.calls[1].reject(new ConvexError({ field: 'logo', code: 'logoType', message }));
      await o.flush();
      expect(text(fieldError())).toBe(message);
      expect(document.activeElement).toBe(fileInput());
      expect(status()).toBeNull();
      expect(text(fileLabel())).toBe('Upload a logo');
      expect(text(preview())).toBe('CB');
    });

    it('says the logo could not be uploaded when the file post fails, and keeps the page usable', async () => {
      fetchMock.mockResolvedValue(new Response('no', { status: 500 }));
      await choose(file());
      o.convex.calls[0].resolve(POSTED_URL);
      await o.flush();
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        'The logo could not be uploaded.',
      );
      expect(text(failure()?.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(failure());
      expect(o.convex.calls).toHaveLength(1);
      expect(text(fileLabel())).toBe('Upload a logo');
    });

    it('says the logo could not be uploaded when the upload URL cannot be had', async () => {
      await choose(file());
      o.convex.calls[0].reject(new Error('boom'));
      await o.flush();
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        'The logo could not be uploaded.',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows the offline note when the connection drops during the upload', async () => {
      await choose(file());
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
    });
  });

  describe('with a logo', () => {
    beforeEach(() => open(LOGO_URL));

    it('shows the logo in the 48px mark, "Replace logo", and Remove', () => {
      const image = preview().querySelector('img')!;
      expect(image.getAttribute('src')).toBe(LOGO_URL);
      expect(image.getAttribute('alt')).toBe('');
      expect(text(fileLabel())).toBe('Replace logo');
      expect(fileLabel().querySelector('.sr-only')?.textContent).toBe(' logo');
      expect(tokens(fileLabel().className)).toEqual(expect.arrayContaining(tokens(OUTLINE_BUTTON)));
      expect(text(removeButton())).toBe('Remove logo');
      expect(removeButton()?.querySelector('.sr-only')?.textContent).toBe(' logo');
      expect(removeButton()?.getAttribute('data-slot')).toBe('button');
      expect(removeButton()?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(tokens(removeButton()!.className)).toEqual(tokens(OUTLINE_BUTTON));
    });

    it('uploads a replacement the same way', async () => {
      await choose(file('image/jpeg', 2048, 'new.jpg'));
      expect(o.convex.calls.map((c) => c.name)).toEqual([UPLOAD_URL]);
    });

    it('keeps the current mark while the replacement uploads, and after it is refused', async () => {
      await uploadAcceptedFile();
      expect(preview().querySelector('img')?.getAttribute('src')).toBe(LOGO_URL);
      o.convex.calls[1].reject(
        new ConvexError({
          field: 'logo',
          code: 'logoSize',
          message: 'Use an image of 256 KB or less. This one is 300 KB.',
        }),
      );
      await o.flush();
      expect(preview().querySelector('img')?.getAttribute('src')).toBe(LOGO_URL);
      expect(text(fieldError())).toBe('Use an image of 256 KB or less. This one is 300 KB.');
    });
  });

  describe('Remove', () => {
    beforeEach(() => open(LOGO_URL));

    async function pressRemove() {
      removeButton()!.click();
      await o.flush();
    }

    it('asks first, in an alert dialog that takes focus on Cancel, and sends nothing yet', async () => {
      await pressRemove();
      const box = dialog()!;
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Remove the logo?');
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'Your public pages show the initials again. The image is deleted, so upload it again to bring it back.',
      );
      const [cancel, remove] = [...box.querySelectorAll('button')];
      expect([text(cancel), text(remove)]).toEqual(['Cancel', 'Remove logo']);
      expect(tokens(cancel.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(tokens(remove.className)).toEqual(tokens(DESTRUCTIVE_BUTTON));
      expect(document.activeElement).toBe(cancel);
      expect(o.convex.calls).toEqual([]);
    });

    it('makes the page behind inert while it is open', async () => {
      await pressRemove();
      expect(page.querySelector('app-admin-details')!.hasAttribute('inert')).toBe(true);
    });

    it('Cancel closes it, sends nothing, and returns focus to Remove', async () => {
      await pressRemove();
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(o.convex.calls).toEqual([]);
      expect(document.activeElement).toBe(removeButton());
    });

    it('Escape cancels it the same way', async () => {
      await pressRemove();
      dialog()!
        .querySelector<HTMLElement>('[data-slot="alert-dialog-content"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await o.flush();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(removeButton());
    });

    it('confirming sends removeLogo for the organization, with "Removing…" while it waits', async () => {
      await pressRemove();
      dialogButton('Remove logo').click();
      await o.flush();
      expect(o.convex.calls.map((c) => [c.kind, c.name, c.args])).toEqual([
        ['mutation', REMOVE_LOGO, { organizationId: COASTAL.organizationId }],
      ]);
      expect(text(dialogButton('Removing'))).toBe('Removing…');
      expect(dialogButton('Removing').getAttribute('aria-disabled')).toBe('true');
    });

    it('on success closes the dialog, shows "Logo removed." in a status that takes focus, and the initials once the query answers', async () => {
      await pressRemove();
      dialogButton('Remove logo').click();
      await o.flush();
      o.convex.calls[0].resolve(null);
      o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
      await o.flush();
      expect(dialog()).toBeNull();
      expect(text(status()?.querySelector('[data-slot="alert-title"]'))).toBe('Logo removed.');
      expect(document.activeElement).toBe(status());
      expect(preview().querySelector('img')).toBeNull();
      expect(text(preview())).toBe('CB');
      expect(text(fileLabel())).toBe('Upload a logo');
      expect(removeButton()).toBeNull();
    });

    it('on failure keeps the dialog open with an error, and the logo stays', async () => {
      await pressRemove();
      dialogButton('Remove logo').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('boom'));
      await o.flush();
      const box = dialog()!;
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        'The logo could not be removed.',
      );
      expect(preview().querySelector('img')).not.toBeNull();
    });

    it('pressed offline, sends nothing and says so in the dialog', async () => {
      await pressRemove();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      dialogButton('Remove logo').click();
      await o.flush();
      expect(o.convex.calls).toEqual([]);
      expect(text(dialog()!.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
    });
  });

  describe('offline', () => {
    beforeEach(() => open(LOGO_URL));

    async function goOffline() {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
    }

    it('the control looks disabled but stays focusable, and a press is stopped with the offline note', async () => {
      await goOffline();
      expect(fileLabel().getAttribute('aria-disabled')).toBe('true');
      expect(fileLabel().classList).toContain('opacity-50');
      expect(fileInput().disabled).toBe(false);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      fileInput().dispatchEvent(click);
      await o.flush();
      expect(click.defaultPrevented).toBe(true);
      expect(o.convex.calls).toEqual([]);
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(text(failure()?.querySelector('[data-slot="alert-description"]'))).toBe(
        "Your logo is unchanged. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(failure());
    });

    it('a file that is still chosen while offline sends nothing and shows the same note', async () => {
      await goOffline();
      await choose(file());
      expect(o.convex.calls).toEqual([]);
      expect(failure()).not.toBeNull();
    });
  });

  describe('when it is online and idle', () => {
    beforeEach(() => open());

    it('lets the picker open', () => {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      fileInput().dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
    });
  });
});
