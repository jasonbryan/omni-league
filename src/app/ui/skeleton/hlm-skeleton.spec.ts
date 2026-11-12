import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { allRadiusClasses } from '../testing/radius-classes';
import { HlmSkeleton, SKELETON_CLASSES } from './hlm-skeleton';

@Component({
  imports: [HlmSkeleton],
  template: `<span hlmSkeleton class="h-4 rounded-full"></span>`,
})
class Host {}

describe('HlmSkeleton', () => {
  it('pulses only when motion is allowed, and leaves the one radius class to the caller', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = (fixture.nativeElement as HTMLElement).querySelector('span')!;
    expect(element.getAttribute('data-slot')).toBe('skeleton');
    expect(SKELETON_CLASSES).toBe('bg-muted motion-safe:animate-pulse');
    expect([...element.classList].sort()).toEqual(
      [...SKELETON_CLASSES.split(' '), 'h-4', 'rounded-full'].sort(),
    );
    expect(allRadiusClasses([element])).toEqual([['rounded-full']]);
  });
});
