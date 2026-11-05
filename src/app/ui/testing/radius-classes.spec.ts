import { describe, expect, it } from 'vitest';
import { allRadiusClasses, radiusClasses } from './radius-classes';

function elementWith(classes: string): HTMLElement {
  const element = document.createElement('span');
  element.className = classes;
  return element;
}

describe('radiusClasses', () => {
  it('lists the radius classes in attribute order', () => {
    expect(radiusClasses(elementWith('size-9 rounded-lg md:rounded-xl bg-muted'))).toEqual([
      'rounded-lg',
      'md:rounded-xl',
    ]);
  });

  it('counts the bare class, every size, and arbitrary values', () => {
    const classes = [
      'rounded',
      'rounded-none',
      'rounded-xs',
      'rounded-sm',
      'rounded-md',
      'rounded-lg',
      'rounded-xl',
      'rounded-2xl',
      'rounded-3xl',
      'rounded-4xl',
      'rounded-full',
      'rounded-[4px]',
      'rounded-(--card-radius)',
    ];
    expect(radiusClasses(elementWith(classes.join(' ')))).toEqual(classes);
  });

  it('counts a class behind stacked variants', () => {
    expect(radiusClasses(elementWith('md:hover:rounded-md [&>span]:rounded-lg'))).toEqual([
      'md:hover:rounded-md',
      '[&>span]:rounded-lg',
    ]);
  });

  it('does not count side and corner classes', () => {
    expect(
      radiusClasses(elementWith('rounded-t-lg rounded-tl-md rounded-s-lg rounded-md')),
    ).toEqual(['rounded-md']);
  });

  it('does not count a class that only contains the word', () => {
    expect(radiusClasses(elementWith('not-rounded rounded-lg-x unrounded'))).toEqual([]);
  });

  it('returns an empty list for an element without a class attribute', () => {
    expect(radiusClasses(document.createElement('span'))).toEqual([]);
  });

  it('throws for a missing element, so a wrong selector fails the test', () => {
    expect(() => radiusClasses(null)).toThrow('radiusClasses needs an element');
  });

  it('allRadiusClasses lists each element in order', () => {
    const list = [elementWith('rounded-lg'), elementWith('rounded-full')];
    expect(allRadiusClasses(list)).toEqual([['rounded-lg'], ['rounded-full']]);
  });
});
