import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PAGE_STALLED_ANNOUNCEMENT, PageLoadStatus } from './page-load-status';

@Component({
  imports: [PageLoadStatus],
  template: `<app-page-load-status [stalled]="stalled()" />`,
})
class Host {
  readonly stalled = signal(false);
}

describe('PageLoadStatus', () => {
  it('is an empty status region until stalled, then fills the same element', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector<HTMLElement>('[role="status"]')!;
    expect(region.classList.contains('sr-only')).toBe(true);
    expect(region.textContent).toBe('');

    fixture.componentInstance.stalled.set(true);
    await fixture.whenStable();
    expect(host.querySelector('[role="status"]')).toBe(region);
    expect(region.textContent).toBe(PAGE_STALLED_ANNOUNCEMENT);

    fixture.componentInstance.stalled.set(false);
    await fixture.whenStable();
    expect(region.textContent).toBe('');
  });
});
