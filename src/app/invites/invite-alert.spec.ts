import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expectAlertClasses, expectAlertSlots } from '../ui/testing/alert';
import { InviteAlert } from './invite-alert';

@Component({
  imports: [InviteAlert],
  template: `
    <app-invite-alert
      kind="error"
      title="The invite could not be accepted."
      description="Try again."
    />
    <app-invite-alert
      kind="info"
      title="You’re already on the staff."
      description="Nothing to do."
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {}

describe('the invite alert', () => {
  it('shows the title it is given and keeps the focus ring', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const titles = Array.from(host.querySelectorAll('[data-slot="alert-title"]')).map((title) =>
      title.textContent.trim(),
    );
    expect(titles).toEqual(['The invite could not be accepted.', 'You’re already on the staff.']);
    for (const box of Array.from(host.querySelectorAll('[data-slot="alert"]'))) {
      expect(box.className).toContain('focus:outline-2');
    }
  });
});

describe('the invite alert kinds', () => {
  @Component({
    imports: [InviteAlert],
    template: `
      <app-invite-alert kind="error" title="e" description="e" />
      <app-invite-alert kind="notice" title="n" description="n" />
      <app-invite-alert kind="info" title="i" description="i" />
      <app-invite-alert kind="full" title="f" description="f" />
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class Kinds {}

  it('draws an error in the destructive colour, and a notice, an info and a full neutral, a notice with the alert icon and a full with the users icon', async () => {
    const fixture = TestBed.createComponent(Kinds);
    await fixture.whenStable();
    const [error, notice, info, full] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-slot="alert"]'),
    );
    const focusRing = 'outline-offset-2 focus:outline-2 focus:outline-ring';
    expectAlertClasses(error, 'destructive', focusRing);
    expectAlertClasses(notice, 'default', focusRing);
    expectAlertClasses(info, 'default', focusRing);
    expectAlertClasses(full, 'default', focusRing);
    expectAlertSlots(error);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('tabindex')).toBe('-1');
    expect(error.className).toContain('text-destructive');
    expect(notice.className).not.toContain('text-destructive');
    expect(info.className).not.toContain('text-destructive');
    const icon = (box: Element) => box.querySelector('ng-icon')?.innerHTML;
    expect(icon(notice)).toBe(icon(error));
    expect(icon(notice)).not.toBe(icon(info));
    expect(full.className).not.toContain('text-destructive');
    expect(icon(full)).toContain('<circle cx="9" cy="7" r="4"');
  });
});
