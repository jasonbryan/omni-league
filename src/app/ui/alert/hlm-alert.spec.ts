import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from './index';

@Component({
  imports: [HlmAlert, HlmAlertTitle, HlmAlertDescription],
  template: `
    <div hlmAlert id="plain" class="mb-5">
      <div hlmAlertTitle>Title</div>
      <div hlmAlertDescription>Description</div>
    </div>
    <div hlmAlert id="error" variant="destructive" role="alert" tabindex="-1">
      <div hlmAlertTitle>Title</div>
    </div>
  `,
})
class Host {}

const render = () => {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return {
    plain: root.querySelector<HTMLElement>('#plain')!,
    error: root.querySelector<HTMLElement>('#error')!,
  };
};

describe('HlmAlert', () => {
  it('sets the slot and no role, and leaves the role to the caller', () => {
    const { plain, error } = render();
    expect(plain.getAttribute('data-slot')).toBe('alert');
    expect(plain.hasAttribute('role')).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('tabindex')).toBe('-1');
  });

  it('draws the default variant on the card colours, and keeps the caller’s class', () => {
    const { plain } = render();
    expect([...plain.classList]).toEqual(
      expect.arrayContaining([
        'group/alert',
        'rounded-lg',
        'bg-card',
        'text-card-foreground',
        'mb-5',
      ]),
    );
    expect([...plain.classList]).not.toContain('text-destructive');
  });

  it('draws the destructive variant with a destructive description', () => {
    const { error } = render();
    expect([...error.classList]).toEqual(
      expect.arrayContaining([
        'group/alert',
        'bg-card',
        'text-destructive',
        '*:data-[slot=alert-description]:text-destructive/90',
      ]),
    );
    expect([...error.classList]).not.toContain('text-card-foreground');
  });

  it('shares one base between the variants', () => {
    const { plain, error } = render();
    const base = (element: HTMLElement) =>
      [...element.classList].filter(
        (name) =>
          !['text-card-foreground', 'text-destructive', 'mb-5'].includes(name) &&
          !name.includes('text-destructive/90'),
      );
    expect(base(error).sort()).toEqual(base(plain).sort());
  });

  it('lays an icon and the text out in two columns, with no action padding unless an action is there', () => {
    const { plain } = render();
    expect([...plain.classList]).toEqual(
      expect.arrayContaining([
        'has-[>ng-icon]:grid-cols-[auto_1fr]',
        '*:[ng-icon]:row-span-2',
        'has-data-[slot=alert-action]:pe-18',
      ]),
    );
  });

  it('puts the title in the second column when an icon is there, and the description under it', () => {
    const { plain } = render();
    const title = plain.querySelector<HTMLElement>('[data-slot="alert-title"]')!;
    const description = plain.querySelector<HTMLElement>('[data-slot="alert-description"]')!;
    expect([...title.classList]).toEqual(
      expect.arrayContaining(['font-medium', 'group-has-[>ng-icon]/alert:col-start-2']),
    );
    expect([...description.classList]).toEqual(
      expect.arrayContaining([
        'text-muted-foreground',
        'text-sm',
        'text-balance',
        'md:text-pretty',
      ]),
    );
    expect([...description.classList]).not.toContain('col-start-2');
  });

  it('styles links inside the title and description', () => {
    const { plain } = render();
    for (const slot of ['alert-title', 'alert-description']) {
      const part = plain.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
      expect([...part.classList]).toEqual(
        expect.arrayContaining([
          '[&_a]:hover:text-foreground',
          '[&_a]:underline',
          '[&_a]:underline-offset-3',
        ]),
      );
    }
  });
});
