import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lucideEyeOff } from '@ng-icons/lucide';
import { AdminAlert } from './admin-alert';

// The alert's `note` kind (#67), design/mockups/67-organization-staff.html states 8 to 10: the
// "This is the only time the link is shown." note draws the eye-off icon.

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
