import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  EnvironmentInjector,
  afterRenderEffect,
  createComponent,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  viewChild,
  type EnvironmentProviders,
} from '@angular/core';
import { AppUpdates } from '../core/service-worker/app-updates';

const CARD =
  'fixed inset-x-3 bottom-3 z-40 rounded-xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-card-foreground shadow-lg ring-1 ring-foreground/10 sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-96';
const BUTTON =
  "data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2";
const RELOAD_BUTTON = `${BUTTON} bg-primary text-primary-foreground [a]:hover:bg-primary/90`;
const LATER_BUTTON = `${BUTTON} hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground`;

/**
 * While a card shows, the page gets bottom padding and `scroll-padding-bottom` equal to the card's height plus its gap to the window edge, so a focused control is never hidden under it (WCAG 2.4.11).
 * The button classes are those of hlmBtn (default, and ghost for Later), written out as in the shell's menu button, so the prompt needs none of the helm button code.
 * The icons are Lucide's, drawn inline: the prompt loads with the first page, and `@ng-icons/lucide` there would bring every icon the app uses into the initial bundle.
 */
@Component({
  selector: 'app-update-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (updates.card()) {
      @case ('ready') {
        <section #card aria-labelledby="update-title" [class]="cardClasses">
          <div class="flex items-start gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
            >
              <svg
                class="size-4.5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <h2 id="update-title" class="text-sm font-semibold">
                A new version of Omni League is ready
              </h2>
              <p class="mt-1 text-sm text-muted-foreground">
                It loads by itself when you leave this page, so you can finish what you're typing.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-slot="button"
                  [class]="reloadClasses"
                  (click)="updates.reload()"
                >
                  <svg
                    data-icon="inline-start"
                    class="pointer-events-none size-4 shrink-0"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  Reload
                </button>
                <button type="button" data-slot="button" [class]="laterClasses" (click)="later()">
                  Later
                </button>
              </div>
            </div>
          </div>
        </section>
      }
      @case ('unrecoverable') {
        <section #card role="alert" aria-labelledby="update-title" [class]="cardClasses">
          <div class="flex items-start gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
            >
              <svg
                class="size-4.5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <h2 id="update-title" class="text-sm font-semibold">Omni League needs to reload</h2>
              <p class="mt-1 text-sm text-muted-foreground">
                Part of the app could not be loaded after an update. Reload to keep going.
              </p>
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  data-slot="button"
                  [class]="reloadClasses"
                  (click)="updates.reload()"
                >
                  <svg
                    data-icon="inline-start"
                    class="pointer-events-none size-4 shrink-0"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  Reload
                </button>
              </div>
            </div>
          </div>
        </section>
      }
    }
    <!-- Present from the start, so the text added later is announced once. -->
    <p role="status" class="sr-only">
      @if (updates.card() === 'ready') {
        A new version of Omni League is ready.
      }
    </p>
  `,
})
export class UpdatePrompt {
  protected readonly updates = inject(AppUpdates);
  protected readonly cardClasses = CARD;
  protected readonly reloadClasses = RELOAD_BUTTON;
  protected readonly laterClasses = LATER_BUTTON;
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly document = inject(DOCUMENT);

  constructor() {
    const root = this.document.documentElement;
    const body = this.document.body;
    afterRenderEffect((onCleanup) => {
      const card = this.card()?.nativeElement;
      if (!card) return;
      const write = () => {
        const gap = parseFloat(getComputedStyle(card).bottom) || 0;
        const space = `${String(card.getBoundingClientRect().height + gap)}px`;
        root.style.scrollPaddingBottom = space;
        body.style.paddingBottom = space;
      };
      write();
      // Every supported browser has ResizeObserver; jsdom (unit tests) does not.
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
      observer?.observe(card);
      onCleanup(() => {
        observer?.disconnect();
        root.style.removeProperty('scroll-padding-bottom');
        body.style.removeProperty('padding-bottom');
      });
    });
  }

  protected later(): void {
    const cardHadFocus = this.card()?.nativeElement.contains(this.document.activeElement) ?? false;
    this.updates.later();
    if (cardHadFocus) this.focusMain();
  }

  /** Focus must not fall to `<body>`, so the next Tab starts in the page content. */
  private focusMain(): void {
    this.document.getElementById('main')?.focus({ preventScroll: true });
  }
}

/** Added at the end of `<body>`, after the app, so Tab reaches it after the page content. It is created in the browser only and never in the server render, so the server HTML that crawlers see does not change. */
export function provideUpdatePrompt(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      if (!inject(AppUpdates).start()) return;
      const ref = createComponent(UpdatePrompt, {
        environmentInjector: inject(EnvironmentInjector),
      });
      inject(ApplicationRef).attachView(ref.hostView);
      inject(DOCUMENT).body.append(ref.location.nativeElement as HTMLElement);
    }),
  ]);
}
