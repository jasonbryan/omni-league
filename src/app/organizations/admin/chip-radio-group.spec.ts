import { Component, signal, viewChild } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';

const OPTIONS: readonly ChipOption[] = [
  { key: 'beachVolleyball', label: 'Beach volleyball' },
  { key: 'soccer', label: 'Soccer' },
  { key: 'softball', label: 'Softball' },
];

@Component({
  imports: [ChipRadioGroup],
  template: `
    <app-chip-radio-group
      name="sport"
      legend="Sport"
      [options]="options"
      [value]="value()"
      [description]="description()"
      [error]="error()"
      (chosen)="chosen.push($event); value.set($event)"
    />
  `,
})
class Host {
  readonly options = OPTIONS;
  readonly group = viewChild.required(ChipRadioGroup);
  readonly value = signal<string | null>(null);
  readonly description = signal<string | null>('The division options below are this sport’s.');
  readonly error = signal<string | null>(null);
  readonly chosen: string[] = [];
}

describe('chip radio group', () => {
  let fixture: ComponentFixture<Host>;
  let root: HTMLElement;
  const inputs = () => [...root.querySelectorAll<HTMLInputElement>('brn-radio input')];
  const labels = () => [...root.querySelectorAll<HTMLLabelElement>('label')];

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('is one radiogroup on an inner div, named by the legend, inside the fieldset', () => {
    const groups = root.querySelectorAll('[role="radiogroup"]');
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.tagName).toBe('DIV');
    expect(group.parentElement?.tagName).toBe('FIELDSET');
    expect(group.getAttribute('aria-labelledby')).toBe('sport-legend');
    expect(root.querySelector('legend')!.id).toBe('sport-legend');
    expect(root.querySelector('fieldset')!.hasAttribute('role')).toBe(false);
  });

  it('holds one label per chip, each wrapping one brn-radio with one native radio named by the chip text', () => {
    expect(labels()).toHaveLength(3);
    for (const [index, label] of labels().entries()) {
      expect(label.querySelectorAll('brn-radio')).toHaveLength(1);
      expect(label.querySelectorAll('input[type="radio"]')).toHaveLength(1);
      expect(label.textContent?.trim()).toBe(OPTIONS[index].label);
    }
    expect(inputs().map((input) => [input.name, input.value])).toEqual(
      OPTIONS.map(({ key }) => ['sport', key]),
    );
  });

  it('gives each input the id <name>-<key> and its brn-radio host that id with -radio', () => {
    expect(inputs().map((input) => input.id)).toEqual([
      'sport-beachVolleyball',
      'sport-soccer',
      'sport-softball',
    ]);
    expect([...root.querySelectorAll('brn-radio')].map((host) => host.id)).toEqual([
      'sport-beachVolleyball-radio',
      'sport-soccer-radio',
      'sport-softball-radio',
    ]);
  });

  it('draws the chip on the brn-radio and leaves the hlm-radio host without chip classes', () => {
    for (const host of root.querySelectorAll('hlm-radio')) {
      expect(host.className.split(/\s+/).filter(Boolean)).toEqual(['shrink-0']);
    }
    for (const radio of root.querySelectorAll('brn-radio')) {
      expect(radio.classList.contains('rounded-full')).toBe(true);
      expect(radio.classList.contains('h-9')).toBe(true);
    }
  });

  it('puts the chip layout on an inner div in the group, which carries the radio group classes', () => {
    const group = root.querySelector('[role="radiogroup"]')!;
    const layout = group.firstElementChild!;
    expect(group.classList.contains('grid')).toBe(true);
    expect(layout.className.split(/\s+/)).toEqual(['flex', 'flex-wrap', 'gap-2']);
    expect([...layout.children].every((child) => child.tagName === 'LABEL')).toBe(true);
  });

  it('puts data-checked on the chosen chip only, true or false as brain binds it', async () => {
    const checked = () =>
      [...root.querySelectorAll('brn-radio')].map((radio) => radio.getAttribute('data-checked'));
    expect(checked()).toEqual(['false', 'false', 'false']);
    fixture.componentInstance.value.set('soccer');
    await settle();
    expect(checked()).toEqual(['false', 'true', 'false']);
    expect(inputs().map((input) => input.checked)).toEqual([false, true, false]);
  });

  it('emits the key of the chip that is chosen, once, and not for the value it is given', async () => {
    fixture.componentInstance.value.set('soccer');
    await settle();
    expect(fixture.componentInstance.chosen).toEqual([]);
    inputs()[2].click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual(['softball']);
    expect(inputs().map((input) => input.checked)).toEqual([false, false, true]);
  });

  it('chooses a chip when its text is pressed', async () => {
    labels()[1].click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual(['soccer']);
  });

  it('links the fieldset to its description, and adds the error once it shows', async () => {
    const fieldset = root.querySelector('fieldset')!;
    expect(fieldset.getAttribute('aria-describedby')).toBe('sport-description');
    expect(fieldset.hasAttribute('data-invalid')).toBe(false);
    fixture.componentInstance.error.set('Choose a sport.');
    await settle();
    expect(fieldset.getAttribute('aria-describedby')).toBe('sport-description sport-error');
    expect(fieldset.getAttribute('data-invalid')).toBe('true');
    expect(root.querySelector('#sport-error')!.textContent).toContain('Choose a sport.');
  });

  it('describes every radio by the error while it shows, and by nothing once it clears', async () => {
    const describedBy = () => inputs().map((input) => input.getAttribute('aria-describedby'));
    expect(describedBy()).toEqual([null, null, null]);
    fixture.componentInstance.error.set('Choose a sport.');
    await settle();
    expect(describedBy()).toEqual(['sport-error', 'sport-error', 'sport-error']);
    fixture.componentInstance.error.set(null);
    await settle();
    expect(describedBy()).toEqual([null, null, null]);
  });

  it('puts no aria-invalid on a radio, the group, or the fieldset', async () => {
    fixture.componentInstance.error.set('Choose a sport.');
    await settle();
    expect(root.querySelectorAll('[aria-invalid]')).toHaveLength(0);
  });

  it('leaves the radios without the invalid edge of the radio buttons while the error shows', async () => {
    fixture.componentInstance.error.set('Choose a sport.');
    await settle();
    for (const radio of root.querySelectorAll('brn-radio')) {
      expect(radio.classList.contains('border-destructive')).toBe(false);
    }
  });

  it('focuses the first radio through focus()', () => {
    fixture.componentInstance.group().focus();
    expect(document.activeElement).toBe(inputs()[0]);
  });

  it('chooses nothing and shows no error while a radio is only focused', async () => {
    inputs()[1].focus();
    inputs()[2].focus();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual([]);
    expect(root.querySelector('#sport-error')).toBeNull();
  });
});
