import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { FormField, form, type FieldTree } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircleAlert, lucideUndo2 } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import {
  ConvexOfflineError,
  injectOfflineCause,
  injectOnline,
  offlineTitle,
} from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { HlmFieldImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { OUTLINE_BUTTON } from './button-classes';

export interface PlacesSaved {
  saved: string;
  restored: string;
  undo: () => Promise<unknown>;
}

export type PlacesRule = (
  places: number | undefined,
  registered: number,
) => { message: string } | null;

export type PlacesSave = (target: string, places: number) => Promise<PlacesSaved>;

type FormAlert = 'offline' | 'failed';

interface PlacesText {
  places: string;
}

const RESTORE_FAILED = 'Places could not be restored. Try again.';
const STATUS_CLASSES =
  'mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground';

function placesRefusalOf(failure: unknown): string | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, message } = data as Record<string, unknown>;
  return field === 'places' && typeof message === 'string' ? message : null;
}

/** The server checks again, so `rule` only has to agree with it. */
@Component({
  selector: 'app-places-editor',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinner,
    MousePressKeepsFocus,
    NgIcon,
  ],
  providers: [provideIcons({ lucideCheck, lucideCircleAlert, lucideUndo2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form novalidate (submit)="submit($event)" (input)="typedIn()">
      @if (alert(); as kind) {
        @if (kind === 'offline') {
          <app-admin-offline-alert
            #failureAlert
            description="Your change is still here. Try again when you're connected."
            class="mb-3"
          />
        } @else {
          <app-admin-alert
            #failureAlert
            kind="error"
            title="The places could not be saved."
            description="Your change is still here. Check your connection and try again."
            class="mb-3"
          />
        }
      }
      <div
        hlmField
        [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
        [attr.data-invalid]="error() ? 'true' : null"
      >
        <label hlmFieldLabel [for]="ids().input"
          >Places<span class="sr-only"> for {{ subject() }}</span></label
        >
        <div class="flex items-start gap-2">
          <div class="w-28 shrink-0">
            <input
              hlmInput
              #field
              [id]="ids().input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [formField]="fields.places"
              (blur)="shown.left()"
              [attr.aria-describedby]="
                error() ? ids().description + ' ' + ids().error : ids().description
              "
              [attr.aria-invalid]="error() ? 'true' : null"
              [attr.data-invalid]="error() ? 'true' : null"
              [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
            />
          </div>
          <button
            type="submit"
            data-slot="button"
            appMousePressKeepsFocus
            [class]="outlineButton"
            [class.opacity-50]="!online() && !saving()"
            [attr.aria-disabled]="saving() || !online() ? 'true' : null"
          >
            @if (saving()) {
              <hlm-spinner data-icon="inline-start" />Saving…
            } @else {
              Save places<span class="sr-only"> for {{ subject() }}</span>
            }
          </button>
        </div>
        <p hlmFieldDescription [id]="ids().description">From {{ minimum() }} to {{ maximum() }}.</p>
        @if (error(); as error) {
          <div hlmFieldError [id]="ids().error">
            <ng-icon
              name="lucideCircleAlert"
              class="mt-0.5 shrink-0 text-base"
              aria-hidden="true"
            />
            <span>{{ error }}</span>
          </div>
        }
      </div>
      <div role="status" data-slot="places-status">
        @if (outcome(); as outcome) {
          <div #statusBox tabindex="-1" [class]="statusClasses">
            <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />
            <span class="font-medium">{{ outcome.text }}</span>
            @if (outcome.undo) {
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                [class.opacity-50]="!online() && !undoing()"
                [attr.aria-disabled]="undoing() || !online() ? 'true' : null"
                (click)="undo()"
              >
                <ng-icon name="lucideUndo2" class="text-base" aria-hidden="true" />{{
                  undoing() ? 'Undoing…' : 'Undo'
                }}
              </button>
            }
            @if (undoNote(); as note) {
              <span class="basis-full">{{ note }}</span>
            }
          </div>
        }
      </div>
      <p role="status" class="sr-only">{{ saving() ? 'Saving the places.' : '' }}</p>
    </form>
  `,
})
export class PlacesEditor {
  private readonly injector = inject(Injector);
  private readonly cause = injectOfflineCause();
  private destroyed = false;

  readonly target = input.required<string>();
  readonly subject = input.required<string>();
  readonly places = input.required<number>();
  readonly registered = input.required<number>();
  readonly maximum = input.required<number>();
  readonly rule = input.required<PlacesRule>();
  readonly save = input.required<PlacesSave>();

  protected readonly online = injectOnline();
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly statusClasses = STATUS_CLASSES;
  protected readonly minimum = computed(() => Math.max(1, this.registered()));
  protected readonly ids = computed(() => {
    const base = `places-${this.target()}`;
    return { input: base, description: `${base}-description`, error: `${base}-error` };
  });

  /** Follows the places the server holds until the user types, so a live change never overwrites their text. */
  private readonly model: WritableSignal<PlacesText> = linkedSignal<number, PlacesText>({
    source: () => this.places(),
    computation: (places, previous) =>
      previous && untracked(this.typed) ? previous.value : { places: String(places) },
  });
  protected readonly fields: FieldTree<PlacesText> = form(this.model);
  private readonly value = computed(() => limitFromText(this.model().places));
  private readonly clientError = computed(
    () => this.rule()(this.value(), this.registered())?.message ?? null,
  );
  protected readonly shown = new ShownUntilValid(
    () => this.clientError() !== null,
    () => this.fields.places().dirty(),
  );
  private readonly serverError = linkedSignal<string, string | null>({
    source: () => this.model().places,
    computation: () => null,
  });
  protected readonly error = computed(() =>
    this.shown.shown() ? this.clientError() : this.serverError(),
  );

  private readonly typed = signal(false);
  protected readonly saving = signal(false);
  protected readonly undoing = signal(false);
  protected readonly alert = signal<FormAlert | null>(null);
  protected readonly undoNote = signal<string | null>(null);
  protected readonly outcome = signal<{
    text: string;
    undo: (() => Promise<unknown>) | null;
  } | null>(null);
  private restoredText = '';

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly statusBox = viewChild<ElementRef<HTMLElement>>('statusBox');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected typedIn(): void {
    this.typed.set(true);
    this.clearStatus();
  }

  private clearStatus(): void {
    this.outcome.set(null);
    this.undoNote.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    this.alert.set(null);
    this.clearStatus();
    this.shown.submitted();
    if (this.clientError() !== null) {
      this.focusAfterRender(() => this.field().nativeElement.focus());
      return;
    }
    if (!this.online()) {
      this.showAlert('offline');
      return;
    }
    this.saving.set(true);
    try {
      const saved = await this.save()(this.target(), this.value()!);
      this.typed.set(false);
      this.fields.places().reset();
      this.restoredText = saved.restored;
      this.outcome.set({ text: saved.saved, undo: saved.undo });
    } catch (failure) {
      this.failed(failure);
    } finally {
      this.saving.set(false);
    }
  }

  protected async undo(): Promise<void> {
    const undo = this.outcome()?.undo;
    if (!undo || this.undoing()) return;
    this.undoNote.set(null);
    if (!this.online()) {
      this.undoNote.set(this.offlineNote());
      return;
    }
    this.undoing.set(true);
    try {
      await undo();
      this.outcome.set({ text: this.restoredText, undo: null });
      // The Undo button that had focus is gone.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.undoNote.set(
        failure instanceof ConvexOfflineError
          ? this.offlineNote()
          : (placesRefusalOf(failure) ?? RESTORE_FAILED),
      );
    } finally {
      this.undoing.set(false);
    }
  }

  private failed(failure: unknown): void {
    if (this.destroyed) return;
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const refusal = placesRefusalOf(failure);
    if (refusal) {
      this.serverError.set(refusal);
      this.focusAfterRender(() => this.field().nativeElement.focus());
      return;
    }
    this.showAlert('failed');
  }

  private showAlert(alert: FormAlert): void {
    this.alert.set(alert);
    this.focusAfterRender(() => this.failureAlert()?.focus());
  }

  private offlineNote(): string {
    return `${offlineTitle(this.cause(), 'undone')} Try again when you're connected.`;
  }

  private focusAfterRender(focus: () => void): void {
    if (this.destroyed) return;
    afterNextRender(focus, { injector: this.injector });
  }
}
