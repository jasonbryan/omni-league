import { TestBed } from '@angular/core/testing';
import { SavedCopyNote } from './saved-copy-note';
import { formatSavedTime } from './saved-time';

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);

function create(savedAt = SAVED_AT) {
  const fixture = TestBed.createComponent(SavedCopyNote);
  fixture.componentRef.setInput('savedAt', savedAt);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SavedCopyNote', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "Saved copy from <time>. It may have changed since." with a <time datetime>', () => {
    const { host } = create();
    const expected = formatSavedTime(SAVED_AT, NOW);
    expect(host.className).toBe('block');
    const note = host.querySelector('p[data-saved-copy-note]');
    expect(host.children).toHaveLength(1);
    expect(note?.className).toBe('mt-2 flex items-start gap-1.5 text-sm text-muted-foreground');
    expect(text(note)).toBe(`Saved copy from ${expected.text}. It may have changed since.`);
    expect(text(note?.querySelector('.font-medium.text-foreground'))).toBe('Saved copy');
    const time = note?.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(expected.datetime);
    expect(time?.textContent).toBe(expected.text);
    expect(note?.querySelector('ng-icon[name="lucideHistory"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(host.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });

  it('starts no timer: the time is fixed when the note renders', () => {
    const { fixture, host } = create();
    const before = text(host);
    vi.setSystemTime(NOW + 2 * 24 * 60 * 60 * 1000);
    fixture.detectChanges();
    expect(text(host)).toBe(before);
  });
});
