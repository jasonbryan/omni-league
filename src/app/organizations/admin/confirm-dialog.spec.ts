import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideIcons } from '@ng-icons/core';
import { lucideGlobe, lucideLoaderCircle } from '@ng-icons/lucide';
import { overlayPanes, removePopoverApi, stubPopoverApi } from '../../ui/testing/overlay-panes';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { ConfirmDialog, type ConfirmAlertView } from './confirm-dialog';
import { text } from './testing/admin-harness';

@Component({
  imports: [ConfirmDialog],
  providers: [provideIcons({ lucideGlobe })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="opener" type="button">Opener</button>
    <app-confirm-dialog
      icon="lucideGlobe"
      heading="Publish Coed 7v7 Rec?"
      cancelId="demo-cancel"
      confirmLabel="Publish league"
      pendingLabel="Publishing…"
      [variant]="variant()"
      [buttonIcon]="buttonIcon()"
      [pending]="pending()"
      [alert]="alert()"
      [role]="role()"
      [withBody]="withBody()"
      (confirmed)="confirmed = confirmed + 1"
      (closed)="closed = closed + 1"
    >
      <p>It will appear on your public page.</p>
      <input confirm-body id="in-body" aria-label="In the body" />
    </app-confirm-dialog>
  `,
})
class Host {
  readonly dialog = viewChild.required(ConfirmDialog);
  readonly variant = signal<'primary' | 'destructive'>('primary');
  readonly buttonIcon = signal(true);
  readonly pending = signal(false);
  readonly alert = signal<ConfirmAlertView | null>(null);
  readonly role = signal<'alertdialog' | 'dialog'>('alertdialog');
  readonly withBody = signal(false);
  confirmed = 0;
  closed = 0;
}

const OFFLINE: ConfirmAlertView = { kind: 'offline', description: 'Try again when connected.' };
const FAILED: ConfirmAlertView = {
  kind: 'failed',
  title: 'Could not publish.',
  description: 'Check your connection and try again.',
};

const tokens = (value: string) => value.split(' ').sort();
const paths = (svg: Element | null) =>
  Array.from(svg?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d'));
const drawing = (icon: string) =>
  paths(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelector('svg'));

describe('ConfirmDialog', () => {
  async function open() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.componentInstance.dialog().open();
    await fixture.whenStable();
    return fixture;
  }

  const box = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')!;
  const pressEscape = () =>
    box()
      .querySelector('[data-slot="alert-dialog-content"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const cancel = () => document.querySelector<HTMLButtonElement>('#demo-cancel')!;
  const confirm = () =>
    [...box().querySelectorAll<HTMLButtonElement>('button')].find((b) => b !== cancel())!;

  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('opens an alertdialog in the overlay container, not the popover top layer', async () => {
    stubPopoverApi();
    try {
      await open();
      expect(overlayPanes()).toEqual([{ inContainer: true, inPopover: false }]);
    } finally {
      removePopoverApi();
    }
    expect(box().getAttribute('role')).toBe('alertdialog');
    expect(box().getAttribute('aria-labelledby')).toBe(
      box().querySelector('h2')!.getAttribute('id'),
    );
  });

  it('shows the heading, the projected description and the media icon', async () => {
    await open();
    expect(text(box().querySelector('h2'))).toBe('Publish Coed 7v7 Rec?');
    expect(text(box().querySelector('[data-slot="alert-dialog-description"]'))).toBe(
      'It will appear on your public page.',
    );
    expect(paths(box().querySelector('[data-slot="alert-dialog-media"] ng-icon svg'))).toEqual(
      drawing(lucideGlobe),
    );
  });

  it('focuses Cancel on open', async () => {
    await open();
    expect(document.activeElement).toBe(cancel());
  });

  it('Cancel is an outline button, and the confirm button is a primary one with its icon', async () => {
    await open();
    expect(text(cancel())).toBe('Cancel');
    expect(tokens(cancel().className)).toEqual(tokens(OUTLINE_BUTTON));
    expect(text(confirm())).toBe('Publish league');
    expect(tokens(confirm().className)).toEqual(tokens(PRIMARY_BUTTON));
    expect(paths(confirm().querySelector('ng-icon svg'))).toEqual(drawing(lucideGlobe));
    expect(confirm().getAttribute('aria-disabled')).toBeNull();
  });

  it('draws a destructive confirm button, and none of the icon when buttonIcon is off', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.variant.set('destructive');
    fixture.componentInstance.buttonIcon.set(false);
    await fixture.whenStable();
    fixture.componentInstance.dialog().open();
    await fixture.whenStable();
    expect(tokens(confirm().className)).toEqual(tokens(DESTRUCTIVE_BUTTON));
    expect(confirm().querySelector('ng-icon')).toBeNull();
  });

  it('the confirm button emits confirmed, and Cancel closes without it', async () => {
    const fixture = await open();
    confirm().click();
    expect(fixture.componentInstance.confirmed).toBe(1);
    cancel().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.confirmed).toBe(1);
    expect(fixture.componentInstance.closed).toBe(1);
    expect(fixture.componentInstance.dialog().isOpen()).toBe(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('Escape closes it', async () => {
    const fixture = await open();
    pressEscape();
    await fixture.whenStable();
    expect(fixture.componentInstance.dialog().isOpen()).toBe(false);
    expect(fixture.componentInstance.closed).toBe(1);
  });

  describe('while pending', () => {
    it('shows the pending label with a spinner and disables both buttons', async () => {
      const fixture = await open();
      fixture.componentInstance.pending.set(true);
      await fixture.whenStable();
      expect(text(confirm())).toBe('Publishing…');
      expect(confirm().querySelector('ng-icon')!.getAttribute('name')).toBe('lucideLoaderCircle');
      expect(paths(confirm().querySelector('ng-icon svg'))).toEqual(drawing(lucideLoaderCircle));
      expect(cancel().getAttribute('aria-disabled')).toBe('true');
      expect(confirm().getAttribute('aria-disabled')).toBe('true');
    });

    it('ignores Cancel and Escape', async () => {
      const fixture = await open();
      fixture.componentInstance.pending.set(true);
      await fixture.whenStable();
      cancel().click();
      pressEscape();
      await fixture.whenStable();
      expect(fixture.componentInstance.dialog().isOpen()).toBe(true);
      expect(fixture.componentInstance.closed).toBe(0);
    });
  });

  describe('offline', () => {
    afterEach(() => vi.restoreAllMocks());

    it('dims the confirm button and marks it aria-disabled, while Cancel stays usable', async () => {
      const fixture = await open();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await fixture.whenStable();
      expect(confirm().getAttribute('aria-disabled')).toBe('true');
      expect(confirm().classList).toContain('opacity-50');
      expect(cancel().getAttribute('aria-disabled')).toBeNull();
    });
  });

  describe('the alert', () => {
    it('is none until one is set', async () => {
      await open();
      expect(box().querySelector('[data-slot="alert"]')).toBeNull();
    });

    it('shows an error alert with its title inside the description, and focuses it on demand', async () => {
      const fixture = await open();
      fixture.componentInstance.alert.set(FAILED);
      await fixture.whenStable();
      const alert = box().querySelector<HTMLElement>(
        '[data-slot="alert-dialog-description"] [data-slot="alert"]',
      )!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Could not publish.');
      expect(box().querySelector('app-admin-alert')!.classList).toContain('mt-3');
      fixture.componentInstance.dialog().focusAlert();
      await fixture.whenStable();
      expect(document.activeElement).toBe(alert);
    });

    it('shows an offline alert, and focuses it on demand', async () => {
      const fixture = await open();
      fixture.componentInstance.alert.set(OFFLINE);
      await fixture.whenStable();
      const offline = box().querySelector<HTMLElement>('app-admin-offline-alert')!;
      expect(text(offline)).toContain('Try again when connected.');
      fixture.componentInstance.dialog().focusAlert();
      await fixture.whenStable();
      expect(offline.contains(document.activeElement)).toBe(true);
    });
  });

  describe('with a body', () => {
    async function openWithBody() {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.withBody.set(true);
      fixture.componentInstance.role.set('dialog');
      await fixture.whenStable();
      fixture.componentInstance.dialog().open();
      await fixture.whenStable();
      return fixture;
    }

    it('is a dialog, not an alertdialog, with the body in a scrolling row between header and footer', async () => {
      await openWithBody();
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      const content = box().querySelector<HTMLElement>('[data-slot="alert-dialog-content"]')!;
      expect(content.className).toContain('grid-rows-[auto_minmax(0,1fr)_auto]');
      const body = content.querySelector<HTMLElement>(':scope > div.overflow-y-auto')!;
      expect(body.querySelector('#in-body')).not.toBeNull();
      expect(body.previousElementSibling!.getAttribute('data-slot')).toBe('alert-dialog-header');
      expect(body.nextElementSibling!.getAttribute('data-slot')).toBe('alert-dialog-footer');
    });

    it('keeps the role it is given, so a body can stay an alertdialog', async () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.withBody.set(true);
      await fixture.whenStable();
      fixture.componentInstance.dialog().open();
      await fixture.whenStable();
      expect(box().getAttribute('role')).toBe('alertdialog');
      expect(box().querySelector('#in-body')).not.toBeNull();
    });

    it('shows no body without withBody', async () => {
      await open();
      expect(document.querySelector('#in-body')).toBeNull();
    });

    it('puts the alert in the body, below the choices', async () => {
      const fixture = await openWithBody();
      fixture.componentInstance.alert.set(FAILED);
      await fixture.whenStable();
      const alert = box().querySelector('app-admin-alert')!;
      expect(alert.closest('div.overflow-y-auto')).not.toBeNull();
      expect(alert.closest('[data-slot="alert-dialog-description"]')).toBeNull();
      expect(alert.classList).toContain('mt-4');
    });
  });
});
