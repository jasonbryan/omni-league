import { signal } from '@angular/core';
import { AnswerAtPress } from './answer-at-press';
import type { SlugAnswer } from './slug-availability';

describe('AnswerAtPress', () => {
  const live = signal<SlugAnswer>(null);
  const slug = signal('fall-2026');
  const left = () => undefined;
  let held: AnswerAtPress;

  beforeEach(() => {
    live.set(null);
    slug.set('fall-2026');
    held = new AnswerAtPress({ answer: live, left }, () => slug());
  });

  it('follows the live answer until it holds', () => {
    live.set('available');
    expect(held.answer()).toBe('available');
    live.set('taken');
    expect(held.answer()).toBe('taken');
  });

  it('keeps the answer seen at the press while the live answer changes', () => {
    live.set('available');
    held.hold();
    live.set('taken');
    expect(held.answer()).toBe('available');
    live.set(null);
    expect(held.answer()).toBe('available');
  });

  it('holds no answer when none was in at the press', () => {
    held.hold();
    live.set('taken');
    expect(held.answer()).toBeNull();
  });

  it('follows the live answer again after release', () => {
    live.set('available');
    held.hold();
    live.set('taken');
    held.release();
    expect(held.answer()).toBe('taken');
  });

  it('gives no answer for an address other than the one pressed', () => {
    live.set('taken');
    held.hold();
    slug.set('fall-2027');
    expect(held.answer()).toBeNull();
    slug.set('fall-2026');
    expect(held.answer()).toBe('taken');
  });
});
