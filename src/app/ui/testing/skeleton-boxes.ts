import { expect } from 'vitest';
import { radiusClasses } from './radius-classes';

export type RadiusTally = Record<string, number>;

/** Every filled box under `root` must be a skeleton that pulses only where motion is allowed, with the radius tallied. */
export function expectSkeletonBoxes(root: ParentNode, tally: RadiusTally): void {
  const boxes = [...root.querySelectorAll('.bg-muted')];
  const counted: RadiusTally = {};
  for (const box of boxes) {
    const radius = radiusClasses(box).join(' ') || 'none';
    counted[radius] = (counted[radius] ?? 0) + 1;
  }
  expect(counted).toEqual(tally);
  for (const box of boxes) {
    expect(box.getAttribute('data-slot') ?? '').toMatch(/skeleton/);
    expect([...box.classList].filter((name) => name.includes('animate-'))).toEqual([
      'motion-safe:animate-pulse',
    ]);
  }
}
