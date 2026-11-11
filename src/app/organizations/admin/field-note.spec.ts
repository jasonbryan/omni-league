import { TestBed } from '@angular/core/testing';
import { FieldNoteText } from './field-note';
import { WebAddressStatus } from './web-address-status';

const NOTE_CLASSES = 'text-foreground text-sm font-normal flex items-start gap-1.5';
const tokens = (value: string) => value.split(/\s+/).filter(Boolean).sort();

describe('the field note and the web address status', () => {
  it('draws the field note paragraph with the note class set and its text', () => {
    const fixture = TestBed.createComponent(FieldNoteText);
    fixture.componentRef.setInput('id', 'name-note');
    fixture.componentRef.setInput('note', { kind: 'changed', value: 'Bay Rec' });
    fixture.detectChanges();

    const note = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-slot="field-note"]',
    )!;
    expect(note.id).toBe('name-note');
    expect(tokens(note.className)).toEqual(tokens(NOTE_CLASSES));
    expect(note.textContent).toContain('Someone else changed this to "Bay Rec".');
  });

  it('keeps a line free in the note class set while the answer is on its way', () => {
    const fixture = TestBed.createComponent(WebAddressStatus);
    fixture.componentRef.setInput('available', false);
    fixture.componentRef.setInput('reserveRoom', true);
    fixture.detectChanges();

    const status = fixture.nativeElement as HTMLElement;
    expect(tokens(status.className)).toEqual(tokens(`${NOTE_CLASSES} min-h-5`));
    expect(status.getAttribute('role')).toBe('status');
    expect(status.id).toBe('slug-availability');
    expect(status.getAttribute('data-slot')).toBe('field-status');
  });

  it('hides the status from sight when no room is reserved, and says Available when it is', () => {
    const fixture = TestBed.createComponent(WebAddressStatus);
    fixture.componentRef.setInput('available', true);
    fixture.componentRef.setInput('reserveRoom', false);
    fixture.detectChanges();

    const status = fixture.nativeElement as HTMLElement;
    expect(tokens(status.className)).toEqual(['sr-only']);
    expect(status.textContent).toContain('Available');
  });
});
