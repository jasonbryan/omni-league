import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RevealOnFocus } from './reveal-on-focus';

@Component({
  imports: [RevealOnFocus],
  template: `
    <button type="button">Before</button>
    <textarea appRevealOnFocus readonly rows="3"></textarea>
  `,
})
class Host {}

describe('RevealOnFocus', () => {
  let textarea: HTMLTextAreaElement;
  let scrollIntoView: ReturnType<typeof vi.fn<(options?: ScrollIntoViewOptions) => void>>;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement as HTMLElement);
    await fixture.whenStable();
    textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>();
    textarea.scrollIntoView = scrollIntoView;
  });

  afterEach(() => document.body.replaceChildren());

  it('scrolls the whole field into view, by the least distance, when it takes focus', () => {
    textarea.focus();
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('does not scroll before the field takes focus', () => {
    document.querySelector('button')!.focus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
