import { computed, signal, type Signal } from '@angular/core';
import type { SlugAnswer, WebAddressCheck } from './slug-availability';

export class AnswerAtPress {
  readonly answer: Signal<SlugAnswer>;
  private readonly pressed = signal<{ slug: string; answer: SlugAnswer } | null>(null);

  constructor(
    private readonly live: WebAddressCheck,
    private readonly slug: () => string,
  ) {
    this.answer = computed(() => {
      const pressed = this.pressed();
      if (pressed === null) return this.live.answer();
      return pressed.slug === this.slug() ? pressed.answer : null;
    });
  }

  hold(): void {
    this.pressed.set({ slug: this.slug(), answer: this.live.answer() });
  }

  release(): void {
    this.pressed.set(null);
  }
}
