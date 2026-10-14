import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideWifiOff } from '@ng-icons/lucide';
import { injectOnline } from '../core/data/convex';

export const BACK_ONLINE_MS = 5_000;

export const NOTE_HEIGHT_PROPERTY = '--offline-note-h';

/**
 * The host is the region itself, so `sticky` works against the shell's column rather than a wrapper.
 * In the browser it keeps `--offline-note-h` on `<html>` equal to its measured height (unset while empty).
 * html's `scroll-padding-top`, the header's negative scroll margin, and the sidebar's sticky offset add it, so they follow the note however many lines it wraps to (two at 320px).
 */
@Component({
  selector: 'app-offline-note',
  imports: [NgIcon],
  providers: [provideIcons({ lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', class: 'sticky top-14 z-20 block bg-foreground text-background' },
  template: `
    @if (!online()) {
      <p data-offline-note class="flex items-start gap-2 px-3 py-2 text-sm md:px-4 lg:px-6">
        <ng-icon name="lucideWifiOff" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
        <span><span class="font-semibold">You're offline.</span> Changes need a connection.</span>
      </p>
    } @else if (backOnline()) {
      <span class="sr-only">Back online.</span>
    }
  `,
})
export class OfflineNote {
  protected readonly online = injectOnline();
  protected readonly backOnline = signal(false);

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasOffline = false;
    // Starts and clears a timer, which leaves Angular.
    effect(() => {
      clearTimeout(timer);
      if (!this.online()) {
        wasOffline = true;
        this.backOnline.set(false);
      } else if (wasOffline) {
        wasOffline = false;
        this.backOnline.set(true);
        timer = setTimeout(() => this.backOnline.set(false), BACK_ONLINE_MS);
      }
    });
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => clearTimeout(timer));
    this.trackHeight(destroyRef);
  }

  private trackHeight(destroyRef: DestroyRef): void {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const root = inject(DOCUMENT).documentElement;
    afterNextRender(() => {
      const write = () => {
        const height = host.getBoundingClientRect().height;
        if (height > 0) root.style.setProperty(NOTE_HEIGHT_PROPERTY, `${height}px`);
        else root.style.removeProperty(NOTE_HEIGHT_PROPERTY);
      };
      write();
      // Every supported browser has ResizeObserver; jsdom (unit tests) does not.
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
      observer?.observe(host);
      destroyRef.onDestroy(() => {
        observer?.disconnect();
        root.style.removeProperty(NOTE_HEIGHT_PROPERTY);
      });
    });
  }
}
