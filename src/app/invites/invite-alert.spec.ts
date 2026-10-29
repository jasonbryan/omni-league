import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
