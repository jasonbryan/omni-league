import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { allRadiusClasses } from '../testing/radius-classes';
import { HlmSkeleton } from './hlm-skeleton';

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
    expect(element.classList).toContain('motion-safe:animate-pulse');
    expect(element.classList).toContain('bg-muted');
    expect(element.classList).not.toContain('rounded-md');
    expect(element.classList).not.toContain('block');
    expect(allRadiusClasses([element])).toEqual([['rounded-full']]);
  });
});
