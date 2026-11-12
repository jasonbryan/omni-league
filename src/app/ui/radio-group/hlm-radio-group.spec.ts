import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HlmRadioGroupImports } from './index';

@Component({
  imports: [HlmRadioGroupImports],
  template: `
    <p id="pick-legend">Pick one</p>
    <hlm-radio-group
      name="pick"
      aria-labelledby="pick-legend"
      [value]="value()"
      [invalid]="invalid()"
      (valueChange)="chosen.push($any($event)); value.set($any($event))"
    >
      <hlm-radio inputId="pick-a" value="a" aria-describedby="pick-a-note">
        <hlm-radio-indicator />
      </hlm-radio>
      <label for="pick-a">A</label>
      <p id="pick-a-note">First</p>
      <hlm-radio inputId="pick-b" value="b" [disabled]="bDisabled()">
        <hlm-radio-indicator />
      </hlm-radio>
      <label for="pick-b">B</label>
      <hlm-radio inputId="pick-c" value="c" [class]="'extra'">
        <hlm-radio-indicator />
      </hlm-radio>
    </hlm-radio-group>
  `,
})
class Host {
  readonly value = signal<string | null>('a');
  readonly invalid = signal(false);
  readonly bDisabled = signal(false);
  readonly chosen: string[] = [];
}

describe('helm radio group', () => {
  let fixture: ComponentFixture<Host>;
  let root: HTMLElement;
  const inputs = () => [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const indicators = () => [...root.querySelectorAll<HTMLElement>('hlm-radio-indicator')];
  const circles = () => [...root.querySelectorAll<HTMLElement>('brn-radio')];

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    root = fixture.nativeElement;
  });

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('is one radiogroup named by the element it points to, holding one native radio per option', () => {
    const groups = root.querySelectorAll('[role="radiogroup"]');
    expect(groups).toHaveLength(1);
    expect(groups[0].getAttribute('aria-labelledby')).toBe('pick-legend');
    expect(groups[0].getAttribute('data-slot')).toBe('radio-group');
    expect(inputs().map((input) => [input.id, input.name, input.value])).toEqual([
      ['pick-a', 'pick', 'a'],
      ['pick-b', 'pick', 'b'],
      ['pick-c', 'pick', 'c'],
    ]);
  });

  it('gives each input the id it was given, so a label’s for finds it, and its host the id with -radio', () => {
    expect(root.querySelector('label[for="pick-a"]')!.getAttribute('for')).toBe(inputs()[0].id);
    expect([...root.querySelectorAll('brn-radio')].map((host) => host.id)).toEqual([
      'pick-a-radio',
      'pick-b-radio',
      'pick-c-radio',
    ]);
  });

  it('describes the input by the ids it was given and leaves the host without them', () => {
    expect(inputs()[0].getAttribute('aria-describedby')).toBe('pick-a-note');
    expect(root.querySelector('hlm-radio')!.hasAttribute('aria-describedby')).toBe(false);
    expect(inputs()[1].hasAttribute('aria-describedby')).toBe(false);
  });

  it('checks the option whose value the group holds', async () => {
    expect(inputs().map((input) => input.checked)).toEqual([true, false, false]);
    fixture.componentInstance.value.set('c');
    await settle();
    expect(inputs().map((input) => input.checked)).toEqual([false, false, true]);
  });

  it('emits the value of the option that is chosen, once', async () => {
    inputs()[1].click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual(['b']);
    expect(inputs().map((input) => input.checked)).toEqual([false, true, false]);
  });

  it('cannot choose a disabled option', async () => {
    fixture.componentInstance.bDisabled.set(true);
    await settle();
    expect(inputs()[1].disabled).toBe(true);
    inputs()[1].click();
    await settle();
    expect(fixture.componentInstance.chosen).toEqual([]);
    expect(root.querySelector('brn-radio[data-disabled="true"]')!.id).toBe('pick-b-radio');
  });

  it('shows the invalid edge on every radio only while the consumer says invalid', async () => {
    const edge = () => circles().map((el) => el.classList.contains('border-destructive'));
    const normal = () => circles().map((el) => el.classList.contains('border-input'));
    expect(edge()).toEqual([false, false, false]);
    expect(normal()).toEqual([true, true, true]);
    fixture.componentInstance.invalid.set(true);
    await settle();
    expect(edge()).toEqual([true, true, true]);
    expect(normal()).toEqual([false, false, false]);
  });

  it('puts no aria-invalid on the group, which brain owns', async () => {
    fixture.componentInstance.invalid.set(true);
    await settle();
    expect(root.querySelector('[role="radiogroup"]')!.hasAttribute('aria-invalid')).toBe(false);
  });

  it('draws the radio as a filled circle with a dot and a focus ring, from the brn-radio that holds the input', () => {
    const classes = root.querySelector('brn-radio')!.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'group/radio',
        'size-4',
        'rounded-full',
        'border',
        'has-checked:border-primary',
        'has-checked:bg-primary',
        'has-focus-visible:outline-2',
        'has-focus-visible:outline-ring',
      ]),
    );
    expect(indicators()[0].querySelector('span')!.className).toContain('bg-primary-foreground');
  });

  it('dims the radio while it is disabled', async () => {
    fixture.componentInstance.bDisabled.set(true);
    await settle();
    expect(circles().map((el) => el.classList.contains('opacity-50'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('keeps the data-slot that the touch-target rule in base.css selects', () => {
    expect(
      [...root.querySelectorAll('hlm-radio')].map((el) => el.getAttribute('data-slot')),
    ).toEqual(['radio-group-item', 'radio-group-item', 'radio-group-item']);
  });

  it('puts a class bound with [class] on the radio’s element once', () => {
    const radio = root.querySelector('hlm-radio:last-of-type')!;
    expect(radio.classList.contains('extra')).toBe(false);
    expect(root.querySelector('#pick-c-radio')!.classList.contains('extra')).toBe(true);
  });

  it('covers its indicator with the input, so a tap or a keyboard focus lands on the indicator', () => {
    expect(inputs()[0].style.position).toBe('absolute');
    expect(inputs()[0].style.opacity).toBe('0');
    expect(inputs()[0].style.width).toBe('100%');
  });
});

describe('the copied radio group source', () => {
  const dir = join(process.cwd(), 'src/app/ui/radio-group');
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => [file, readFileSync(join(dir, file), 'utf8')] as const);

  it.each(sources)('%s merges no classes at run time', (_, source) => {
    expect(source).not.toMatch(/@spartan-ng\/helm\/utils|from 'clsx'|\bclasses\(|\bhlm\(/);
  });

  it('records its local changes in index.ts', () => {
    const index = sources.find(([file]) => file === 'index.ts')![1];
    expect(index).toContain('Vendored from spartan helm v1.9.0');
    expect(index).toContain('Local changes');
  });
});
