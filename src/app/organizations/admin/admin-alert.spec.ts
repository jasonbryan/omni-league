import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lucideEyeOff, lucideInfo } from '@ng-icons/lucide';
import { expectAlertClasses, expectAlertSlots } from '../../ui/testing/alert';
import { AdminAlert } from './admin-alert';

@Component({
  imports: [AdminAlert],
  template: '<app-admin-alert kind="note" title="This is the only time the link is shown." />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {}

const paths = (svg: Element | null) =>
  Array.from(svg?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d'));

describe('the admin alert note kind', () => {
  it('is a role="note" box that draws the eye-off icon', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-slot="alert"]')!.getAttribute('role')).toBe('note');
    const expected = new DOMParser()
      .parseFromString(lucideEyeOff, 'image/svg+xml')
      .querySelector('svg');
    const drawn = host.querySelector('ng-icon svg');
    expect(drawn).not.toBeNull();
    expect(paths(drawn)).toEqual(paths(expected));
  });
});

@Component({
  imports: [AdminAlert],
  template: '<app-admin-alert kind="info" title="Publish the league first" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class InfoHost {}

describe('the admin alert info kind', () => {
  it('is a box with no role in the neutral classes that draws the info icon', async () => {
    const fixture = TestBed.createComponent(InfoHost);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const box = host.querySelector('[data-slot="alert"]')!;
    expect(box.hasAttribute('role')).toBe(false);
    const classes = box.className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['bg-card', 'text-card-foreground']));
    expect(classes).not.toContain('text-destructive');
    const expected = new DOMParser()
      .parseFromString(lucideInfo, 'image/svg+xml')
      .querySelector('svg');
    const drawn = host.querySelector('ng-icon svg');
    expect(drawn).not.toBeNull();
    expect(paths(drawn)).toEqual(paths(expected));
  });
});

@Component({
  imports: [AdminAlert],
  template: `
    <app-admin-alert kind="success" title="Saved." description="Your changes are live." />
    <app-admin-alert kind="error" title="Not saved." description="Try again." />
    <app-admin-alert kind="note" title="Shown once." />
    <app-admin-alert kind="info" title="Publish first" description="Then invite." />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Kinds {}

describe('the admin alert as helm draws it', () => {
  it('keeps its role, tabindex, slots, and classes in every kind', async () => {
    const fixture = TestBed.createComponent(Kinds);
    await fixture.whenStable();
    const boxes = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-slot="alert"]'),
    );
    expect(boxes.map((box) => box.getAttribute('role'))).toEqual(['status', 'alert', 'note', null]);
    expect(boxes.map((box) => box.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1']);
    expectAlertClasses(boxes[0], 'default');
    expectAlertClasses(boxes[1], 'destructive');
    expectAlertClasses(boxes[2], 'default');
    expectAlertClasses(boxes[3], 'default');
    expectAlertSlots(boxes[0]);
    expectAlertSlots(boxes[1]);
    expectAlertSlots(boxes[2], false);
    expectAlertSlots(boxes[3]);
  });

  it('puts content projected into the description inside it', async () => {
    @Component({
      imports: [AdminAlert],
      template: `<app-admin-alert kind="success" title="Saved." description="Done."
        ><a href="/undo">Undo</a></app-admin-alert
      >`,
    })
    class WithLink {}
    const fixture = TestBed.createComponent(WithLink);
    await fixture.whenStable();
    const description = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-slot="alert-description"]',
    )!;
    expect(description.querySelector('a')?.textContent).toBe('Undo');
  });
});
