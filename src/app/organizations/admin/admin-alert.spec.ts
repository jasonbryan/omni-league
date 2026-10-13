import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lucideEyeOff, lucideInfo } from '@ng-icons/lucide';
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

@Component({
  imports: [AdminAlert],
  template: '<app-admin-alert kind="info" title="Publish the league first" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class InfoHost {}

// The `info` kind (#126), design/mockups/125-126-seasons.html states 22 and 23: the draft-league
// message is a neutral note with the info icon.
describe('the admin alert info kind', () => {
  it('is a role="note" box in the neutral classes that draws the info icon', async () => {
    const fixture = TestBed.createComponent(InfoHost);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const box = host.querySelector('[data-slot="alert"]')!;
    expect(box.getAttribute('role')).toBe('note');
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
