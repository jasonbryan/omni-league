import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StickyFooterFocus } from './sticky-footer-focus';

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
  let scrolled: ReturnType<typeof vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>>;

  function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top } as DOMRect;
  }

  async function render() {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const fixture = TestBed.createComponent(Host);
    element = fixture.nativeElement as HTMLElement;
    document.body.append(element);
    host = fixture.componentInstance;
    await fixture.whenStable();
    const footer = element.querySelector<HTMLElement>('[data-slot="form-footer"]')!;
    footer.getBoundingClientRect = () => rect(570, 640);
    scrolled = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();
    for (const control of element.querySelectorAll<HTMLElement>('input, button')) {
      control.scrollIntoView = scrolled;
    }
    return fixture;
  }

  const field = () => element.querySelector<HTMLInputElement>('#field')!;

  afterEach(() => {
    element?.remove();
    FakeResizeObserver.last = undefined;
    vi.unstubAllGlobals();
  });

  it('scrolls the focused control back into view when the form grows and pushes it under the sticky footer', async () => {
    await render();
    expect(FakeResizeObserver.last?.observed).toEqual([element.querySelector('form')]);
    field().focus();
    field().getBoundingClientRect = () => rect(552, 596);
    FakeResizeObserver.last!.callback();
    expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('leaves the page alone while the focused control is clear of the footer', async () => {
    await render();
    field().focus();
    field().getBoundingClientRect = () => rect(480, 524);
    FakeResizeObserver.last!.callback();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('leaves the page alone when the footer is not sticky, as on wide screens', async () => {
    const fixture = await render();
    host.position.set('static');
    await fixture.whenStable();
    field().focus();
    field().getBoundingClientRect = () => rect(600, 640);
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
    field().getBoundingClientRect = () => rect(572, 592);
    field().focus();
    expect(scrolled).not.toHaveBeenCalled();
    frames.forEach((callback) => callback(0));
    expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('stops observing when the form goes away', async () => {
    const fixture = await render();
    const observer = FakeResizeObserver.last!;
    host.shown.set(false);
    await fixture.whenStable();
    expect(observer.disconnected).toBe(true);
  });
});
