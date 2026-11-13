import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  EnvironmentInjector,
  InjectionToken,
  afterRenderEffect,
  computed,
  createComponent,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  signal,
  viewChild,
  type ComponentRef,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import { AppUpdates } from '../core/service-worker/app-updates';
import { FLOATING_CARD_CLASSES } from '../ui/card/card-classes';

export const UPDATE_PROMPT_LOADER = new InjectionToken<() => Promise<Type<unknown>>>(
  'UPDATE_PROMPT_LOADER',
  { factory: () => () => import('./update-prompt').then((m) => m.UpdatePrompt) },
);

const CARD = `${FLOATING_CARD_CLASSES} fixed inset-x-3 bottom-3 z-40 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-96`;
/** The prompt's Reload button without the classes that never apply here (an icon, the invalid and disabled states, an anchor), so the initial bundle carries fewer. */
const RELOAD_BUTTON =
  'rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none h-8 gap-1.5 px-2.5 bg-primary text-primary-foreground';

type PromptLoad = 'pending' | 'loaded' | 'failed';

/** Stays in the initial bundle because it owns the page's only status region, which must be there empty from the first render, and the message a page needs when the prompt's chunk cannot load. */
@Component({
  selector: 'app-update-fallback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p role="status" class="sr-only">{{ announcement() }}</p>
    @if (showsMessage()) {
      <section
        #card
        data-slot="card"
        role="alert"
        aria-labelledby="update-title"
        [class]="cardClasses"
      >
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
            Reload
          </button>
        </div>
      </section>
    }
  `,
})
export class UpdatePromptFallback {
  protected readonly updates = inject(AppUpdates);
  protected readonly cardClasses = CARD;
  protected readonly reloadClasses = RELOAD_BUTTON;
  private readonly document = inject(DOCUMENT);
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  readonly load = signal<PromptLoad>('pending');

  protected readonly announcement = computed(() =>
    this.load() === 'loaded' && this.updates.card() === 'ready'
      ? 'A new version of Omni League is ready.'
      : '',
  );
  /** A ready version shows its message only once the prompt cannot, because a pending chunk would flash an alert on every normal load. */
  protected readonly showsMessage = computed(() => {
    const card = this.updates.card();
    const load = this.load();
    return (
      (load !== 'loaded' && card === 'unrecoverable') || (load === 'failed' && card === 'ready')
    );
  });

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
}

/**
 * The fallback and then the prompt are added at the end of `<body>`, after the app, so Tab reaches them after the page content.
 * They are created in the browser only and never in the server render, so the server HTML that crawlers see does not change.
 * The initializer neither awaits nor returns the prompt's import, so bootstrap and hydration never wait for the chunk.
 */
export function provideUpdatePrompt(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      if (!inject(AppUpdates).start()) return;
      const environmentInjector = inject(EnvironmentInjector);
      const appRef = inject(ApplicationRef);
      const body = inject(DOCUMENT).body;
      const fallback = createComponent(UpdatePromptFallback, { environmentInjector });
      appRef.attachView(fallback.hostView);
      body.append(fallback.location.nativeElement as HTMLElement);
      inject(UPDATE_PROMPT_LOADER)().then(
        (prompt) => {
          mountPrompt(prompt, fallback, environmentInjector, appRef, body);
        },
        () => {
          fallback.instance.load.set('failed');
        },
      );
    }),
  ]);
}

/** The fallback's message is gone before the prompt renders, and focus on its Reload follows to the prompt's, so it never falls to `<body>`. */
function mountPrompt(
  prompt: Type<unknown>,
  fallback: ComponentRef<UpdatePromptFallback>,
  environmentInjector: EnvironmentInjector,
  appRef: ApplicationRef,
  body: HTMLElement,
): void {
  const hadFocus = (fallback.location.nativeElement as HTMLElement).contains(
    body.ownerDocument.activeElement,
  );
  fallback.instance.load.set('loaded');
  fallback.changeDetectorRef.detectChanges();
  const ref = createComponent(prompt, { environmentInjector });
  appRef.attachView(ref.hostView);
  const host = ref.location.nativeElement as HTMLElement;
  body.append(host);
  ref.changeDetectorRef.detectChanges();
  if (hadFocus) host.querySelector('button')?.focus();
}
