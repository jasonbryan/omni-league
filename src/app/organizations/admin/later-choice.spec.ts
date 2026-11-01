import { onLaterChoiceOrScroll } from './later-choice';

describe('onLaterChoiceOrScroll', () => {
  let root: HTMLElement;
  let excluded: HTMLElement;
  let listening: AbortController;
  let onChoice: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <section tabindex="-1"><p>Text</p></section>
      <a href="/elsewhere">Elsewhere</a>
      <button type="button">Press</button>
      <input />`;
    document.body.append(root);
    excluded = root.querySelector('section')!;
    listening = new AbortController();
    onChoice = vi.fn<() => void>();
    onLaterChoiceOrScroll(document, { exclude: [excluded], signal: listening.signal }, onChoice);
  });

  afterEach(() => {
    listening.abort();
    root.remove();
  });

  const key = (key: string, shiftKey = false) =>
    excluded.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

  it('ignores focus moving to an excluded element', () => {
    excluded.focus();
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('counts focus moving to any other element', () => {
    root.querySelector('input')!.focus();
    expect(onChoice).toHaveBeenCalledTimes(1);
  });

  it('counts a press on a link or button that takes no focus, and ignores a click on text', () => {
    root.querySelector('p')!.click();
    expect(onChoice).not.toHaveBeenCalled();
    root.querySelector('button')!.click();
    expect(onChoice).toHaveBeenCalledTimes(1);
  });

  it('counts Tab, Shift+Tab, and every scroll key, and ignores other keys', () => {
    for (const k of ['Shift', 'Enter', 'a']) key(k);
    expect(onChoice).not.toHaveBeenCalled();
    key('Tab');
    key('Tab', true);
    for (const k of [' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']) key(k);
    for (const k of ['ArrowLeft', 'ArrowRight']) key(k);
    expect(onChoice).toHaveBeenCalledTimes(11);
  });

  it('counts the wheel and a touch scroll, and ignores a scroll the page makes', () => {
    document.dispatchEvent(new Event('scroll'));
    expect(onChoice).not.toHaveBeenCalled();
    excluded.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    excluded.dispatchEvent(new Event('touchmove', { bubbles: true }));
    expect(onChoice).toHaveBeenCalledTimes(2);
  });

  it('ignores focus leaving for nothing, as when the window loses focus', () => {
    excluded.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('stops once the signal aborts', () => {
    listening.abort();
    root.querySelector('button')!.click();
    key('Tab');
    expect(onChoice).not.toHaveBeenCalled();
  });
});
