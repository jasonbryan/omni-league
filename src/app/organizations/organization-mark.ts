import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { initials } from './initials';

export type MarkSize = 'hero' | 'row' | 'preview';

const SIZES: Record<MarkSize, { classes: string; pixels: number }> = {
  hero: {
    classes: 'mt-0.5 size-8 rounded-lg text-xs md:mt-0 md:size-12 md:rounded-xl md:text-base',
    pixels: 48,
  },
  row: { classes: 'size-11 rounded-xl text-sm', pixels: 44 },
  preview: { classes: 'size-12 rounded-xl text-base', pixels: 48 },
};

const BASE = 'flex shrink-0 items-center justify-center overflow-hidden';
const INITIALS = 'bg-accent font-semibold text-accent-foreground';

/** The organization's logo, or its initials when it has none or the image does not load. */
@Component({
  selector: 'app-organization-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[class]': 'classes()' },
  template: `
    @if (showsImage()) {
      <!-- eslint-disable @angular-eslint/template/prefer-ngsrc -- NgOptimizedImage throws when the source changes after render, and warns on any non-square upload -->
      <img
        #logo
        [src]="logoUrl()"
        alt=""
        [attr.width]="pixels()"
        [attr.height]="pixels()"
        class="size-full object-cover"
        (error)="failed.set(true)"
      />
      <!-- eslint-enable @angular-eslint/template/prefer-ngsrc -->
    } @else {
      {{ initials() }}
    }
  `,
})
export class OrganizationMark {
  readonly name = input.required<string>();
  readonly logoUrl = input<string | undefined>(undefined);
  readonly size = input<MarkSize>('hero');

  /** A new URL gets a new try. */
  protected readonly failed = linkedSignal<string | undefined, boolean>({
    source: this.logoUrl,
    computation: () => false,
  });
  protected readonly showsImage = computed(() => !!this.logoUrl() && !this.failed());
  protected readonly initials = computed(() => initials(this.name()));
  protected readonly pixels = computed(() => SIZES[this.size()].pixels);
  protected readonly classes = computed(
    () => `${BASE} ${SIZES[this.size()].classes}${this.showsImage() ? '' : ` ${INITIALS}`}`,
  );

  private readonly logo = viewChild<ElementRef<HTMLImageElement>>('logo');

  constructor() {
    // The server's HTML can fail to load its image before this class listens for `error`.
    afterNextRender(() => {
      const image = this.logo()?.nativeElement;
      if (image?.complete && image.naturalWidth === 0) this.failed.set(true);
    });
  }
}
