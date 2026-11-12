import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrnAlertDialog, BrnAlertDialogContent } from '@spartan-ng/brain/alert-dialog';
import { BrnDialogService } from '@spartan-ng/brain/dialog';
import { provideSpartanOverlay } from '../utils/provide-spartan-overlay';
import {
  HlmAlertDialogContent,
  HlmAlertDialogDescription,
  HlmAlertDialogFooter,
  HlmAlertDialogHeader,
  HlmAlertDialogMedia,
  HlmAlertDialogTitle,
} from './index';

@Component({
  imports: [
    BrnAlertDialog,
    BrnAlertDialogContent,
    HlmAlertDialogContent,
    HlmAlertDialogDescription,
    HlmAlertDialogFooter,
    HlmAlertDialogHeader,
    HlmAlertDialogMedia,
    HlmAlertDialogTitle,
  ],
  providers: [provideSpartanOverlay(Dialog, BrnDialogService)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-alert-dialog>
      <div *brnAlertDialogContent hlmAlertDialogContent tabindex="-1" class="extra">
        <div hlmAlertDialogHeader>
          <div hlmAlertDialogMedia></div>
          <h2 hlmAlertDialogTitle>Publish?</h2>
          <div hlmAlertDialogDescription>It goes public.</div>
        </div>
        <div hlmAlertDialogFooter></div>
      </div>
    </brn-alert-dialog>
  `,
})
class Host {
  readonly dialog = viewChild.required(BrnAlertDialog);
}

const sorted = (element: Element | null) => [...element!.classList].sort();

describe('the alert dialog parts', () => {
  async function open() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.componentInstance.dialog().open();
    await fixture.whenStable();
    return fixture;
  }

  const part = (slot: string) => document.querySelector(`[data-slot="${slot}"]`);

  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('sets each part’s slot', async () => {
    await open();
    for (const slot of [
      'alert-dialog-content',
      'alert-dialog-header',
      'alert-dialog-media',
      'alert-dialog-title',
      'alert-dialog-description',
      'alert-dialog-footer',
    ]) {
      expect(part(slot), slot).not.toBeNull();
    }
  });

  it('gives the content its size and the dialog’s state, and keeps the caller’s class', async () => {
    const fixture = await open();
    const content = part('alert-dialog-content')!;
    expect(content.getAttribute('data-size')).toBe('default');
    expect(content.getAttribute('data-state')).toBe('open');
    expect(content.classList).toContain('extra');
    fixture.componentInstance.dialog().close();
    await fixture.whenStable();
  });

  it('lays the content out as a grid as wide as the viewport less 2rem', async () => {
    await open();
    expect(sorted(part('alert-dialog-content'))).toEqual(
      expect.arrayContaining([
        'group/alert-dialog-content',
        'grid',
        'w-[calc(100vw-2rem)]',
        'bg-popover',
        'text-popover-foreground',
        'rounded-xl',
        'p-4',
        'gap-4',
        'ring-1',
        'shadow-xl',
        'data-[size=default]:max-w-xs',
        'data-[size=default]:sm:max-w-sm',
      ]),
    );
  });

  it('names the dialog by its title and describes it by its description', async () => {
    await open();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(part('alert-dialog-title')!.id);
    expect(dialog.getAttribute('aria-describedby')).toBe(part('alert-dialog-description')!.id);
  });

  it('draws the media tile on the accent colours, in the first column of the header', async () => {
    await open();
    expect(sorted(part('alert-dialog-media'))).toEqual(
      expect.arrayContaining([
        'inline-flex',
        'size-10',
        'rounded-md',
        'bg-accent',
        'text-accent-foreground',
        'sm:group-data-[size=default]/alert-dialog-content:row-span-2',
      ]),
    );
    expect(sorted(part('alert-dialog-title'))).toEqual(
      expect.arrayContaining(['text-base', 'font-medium']),
    );
    expect(sorted(part('alert-dialog-description'))).toEqual(
      expect.arrayContaining([
        'text-muted-foreground',
        'text-sm',
        'text-balance',
        'md:text-pretty',
      ]),
    );
  });

  it('stacks the footer buttons with Cancel last on a phone and right-aligns them from 640px', async () => {
    await open();
    expect(sorted(part('alert-dialog-footer'))).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-col-reverse',
        'gap-2',
        'sm:flex-row',
        'sm:justify-end',
        'bg-muted/50',
        '-mx-4',
        '-mb-4',
        'rounded-b-xl',
        'border-t',
        'p-4',
      ]),
    );
  });
});
