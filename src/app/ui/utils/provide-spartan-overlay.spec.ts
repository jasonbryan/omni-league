import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrnOverlayService } from '@spartan-ng/brain/overlay';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { BrnTooltip } from '@spartan-ng/brain/tooltip';
import { overlayPanes, removePopoverApi, stubPopoverApi } from '../testing/overlay-panes';
import { provideSpartanOverlay } from './provide-spartan-overlay';

@Component({
  imports: [BrnPopover, BrnPopoverContent, BrnPopoverTrigger],
  providers: [provideSpartanOverlay(BrnOverlayService)],
  template: `
    <brn-popover>
      <button type="button" brnPopoverTrigger>Open</button>
      <div *brnPopoverContent>Content</div>
    </brn-popover>
  `,
})
class PopoverHost {}

@Component({
  imports: [BrnTooltip],
  providers: [provideSpartanOverlay()],
  template: `<button type="button" brnTooltip="Tip" [showDelay]="0">Hover</button>`,
})
class TooltipHost {}

describe('provideSpartanOverlay, in a browser with the popover API', () => {
  beforeEach(stubPopoverApi);
  afterEach(removePopoverApi);

  it('keeps a popover opened through BrnOverlayService in the overlay container', async () => {
    const fixture = TestBed.createComponent(PopoverHost);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();

    expect(overlayPanes()).toEqual([{ inContainer: true, inPopover: false }]);
    fixture.destroy();
  });

  it('keeps a tooltip opened through Overlay in the overlay container', async () => {
    const fixture = TestBed.createComponent(TooltipHost);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector('button')
      ?.dispatchEvent(new FocusEvent('focus'));
    await expect.poll(() => overlayPanes()).toEqual([{ inContainer: true, inPopover: false }]);
    fixture.destroy();
  });
});
