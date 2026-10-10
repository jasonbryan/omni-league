import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideWifiOff } from '@ng-icons/lucide';
import { injectOnline } from '../core/data/convex';

/** How long "Back online." stays in the status region for screen readers. */
export const BACK_ONLINE_MS = 5_000;

/**
 * The offline note (#88; design/mockups/88-offline-note.html): one status region directly below the
 * top bar. While the adapter's `online` signal is false it shows "You're offline. Changes need a
 * connection."; otherwise it is empty, apart from a screen-reader-only "Back online." for 5 seconds
 * after the note goes. It holds no control, so it adds no Tab stop. On the server `online` is always
 * true, so the server HTML holds an empty region.
 *
 * The host is the region itself, so `sticky` works against the shell's column rather than a wrapper.
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
    // Starts and clears a timer, which leaves Angular (Angular conventions, State and data).
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
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
