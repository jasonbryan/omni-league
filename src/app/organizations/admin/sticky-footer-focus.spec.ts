import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GAP_ABOVE_FOOTER_PX, StickyFooterFocus } from './sticky-footer-focus';

class FakeResizeObserver {
  static last: FakeResizeObserver | undefined;
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.last = this;
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
}

@Component({
  imports: [StickyFooterFocus],
  template: `
    @if (shown()) {
      <form appStickyFooterFocus>
        <input id="field" />
        <div id="status" tabindex="-1">Saved.</div>
        <div data-slot="form-footer" [style.position]="position()">
          <button id="submit" type="submit">Save</button>
        </div>
      </form>
    }
  `,
})
class Host {
  readonly shown = signal(true);
  readonly position = signal('sticky');
}

describe('StickyFooterFocus', () => {
  let host: Host;
  let element: HTMLElement;
  let scrolled: ReturnType<typeof vi.fn<(options?: ScrollToOptions) => void>>;
  let scrollY: number;

  function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top } as DOMRect;
  }

  function placeOnPage(element: Element, top: number, bottom: number) {
    element.getBoundingClientRect = () => rect(top - scrollY, bottom - scrollY);
  }

  async function render() {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const fixture = TestBed.createComponent(Host);
    element = fixture.nativeElement as HTMLElement;
    document.body.append(element);
    host = fixture.componentInstance;
    await fixture.whenStable();
    footer().getBoundingClientRect = () => rect(570, 640);
    scrollY = 0;
    scrolled = vi.fn<(options?: ScrollToOptions) => void>((options) => {
      scrollY += options?.top ?? 0;
    });
    vi.spyOn(window, 'scrollBy').mockImplementation(scrolled as typeof window.scrollBy);
    return fixture;
  }

  const field = () => element.querySelector<HTMLInputElement>('#field')!;
  const status = () => element.querySelector<HTMLElement>('#status')!;
  const footer = () => element.querySelector<HTMLElement>('[data-slot="form-footer"]')!;
  const footerTop = () => footer().getBoundingClientRect().top;

  afterEach(() => {
    element?.remove();
    FakeResizeObserver.last = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('scrolls the focused control back into view when the form grows and pushes it under the sticky footer', async () => {
    await render();
    expect(FakeResizeObserver.last?.observed).toEqual([element.querySelector('form')]);
    field().focus();
    placeOnPage(field(), 552, 596);
    FakeResizeObserver.last!.callback();
    expect(scrolled).toHaveBeenCalledOnce();
    expect(field().getBoundingClientRect().bottom).toBe(footerTop() - GAP_ABOVE_FOOTER_PX);
  });

  it('clears the footer once it rises to the bottom of the viewport, when the page is scrolled too little for it to stick', async () => {
    await render();
    vi.stubGlobal('innerHeight', 640);
    const footerHeight = 69;
    const stuckTop = 640 - footerHeight;
    // The form's top holds the footer below the viewport's bottom until the page scrolls 57px.
    footer().getBoundingClientRect = () => {
      const top = Math.max(stuckTop, 628 - scrollY);
      return rect(top, top + footerHeight);
    };
    field().focus();
    placeOnPage(field(), 691, 735);
    FakeResizeObserver.last!.callback();
    expect(footerTop()).toBe(stuckTop);
    expect(field().getBoundingClientRect().bottom).toBe(stuckTop - GAP_ABOVE_FOOTER_PX);
  });

  it('brings a focused element with tabindex="-1" from under the footer to wholly above it', async () => {
    await render();
    placeOnPage(status(), 590, 630);
    status().focus();
    FakeResizeObserver.last!.callback();
    expect(status().getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(status().getBoundingClientRect().bottom).toBeLessThanOrEqual(footerTop());
  });

  it('measures a chip by its label, as the radio inside it is visually hidden', async () => {
    await render();
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    label.append(radio);
    field().before(label);
    placeOnPage(label, 540, 584);
    placeOnPage(radio, 540, 541);
    radio.focus();
    FakeResizeObserver.last!.callback();
    expect(label.getBoundingClientRect().bottom).toBe(footerTop() - GAP_ABOVE_FOOTER_PX);
  });

  it('leaves the page alone while the focused control is clear of the footer', async () => {
    await render();
    field().focus();
    placeOnPage(field(), 480, 524);
    FakeResizeObserver.last!.callback();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('leaves the page alone when the footer is not sticky, as on wide screens', async () => {
    const fixture = await render();
    host.position.set('static');
    await fixture.whenStable();
    field().focus();
    placeOnPage(field(), 600, 640);
    FakeResizeObserver.last!.callback();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('ignores the button inside the footer and focus outside the form', async () => {
    await render();
    element.querySelector<HTMLButtonElement>('#submit')!.focus();
    FakeResizeObserver.last!.callback();
    field().blur();
    FakeResizeObserver.last!.callback();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('checks again a frame after a control takes focus, once the browser has scrolled to it', async () => {
    await render();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    placeOnPage(field(), 572, 592);
    field().focus();
    expect(scrolled).not.toHaveBeenCalled();
    frames.forEach((callback) => callback(0));
    expect(scrolled).toHaveBeenCalledOnce();
    expect(field().getBoundingClientRect().bottom).toBe(footerTop() - GAP_ABOVE_FOOTER_PX);
  });

  it('stops observing when the form goes away', async () => {
    const fixture = await render();
    const observer = FakeResizeObserver.last!;
    host.shown.set(false);
    await fixture.whenStable();
    expect(observer.disconnected).toBe(true);
  });
});
