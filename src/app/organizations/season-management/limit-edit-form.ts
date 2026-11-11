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
  type OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import { ConvexOfflineError, injectOnline } from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../admin/button-classes';
import { DESCRIPTION, FIELD, FIELD_ERROR, FIELD_GROUP, INPUT, LABEL } from '../admin/field-classes';
import { HlmSpinner } from '../../ui/spinner';
import { LIMIT_ALERTS } from './limit-text';

type FormAlert = 'offline' | 'failed';

export interface LimitSpec {
  field: 'maxTeams' | 'maxRosterSize';
  id: string;
  label: string;
  current: number | undefined;
  description: string;
  check: (value: number | undefined) => string | null;
  save: (value: number | null) => Promise<unknown>;
}

function fieldRefusalOf(failure: unknown, field: LimitSpec['field']): string | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field: refused, message } = data as Record<string, unknown>;
  return refused === field && typeof message === 'string' ? message : null;
}

@Component({
  selector: 'app-limit-edit-form',
  imports: [AdminAlert, AdminOfflineAlert, FormField, HlmSpinner, MousePressKeepsFocus, NgIcon],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      [attr.aria-labelledby]="ids().heading"
      (submit)="save($event)"
      (keydown.escape)="cancel()"
    >
      <h3 [id]="ids().heading" class="text-sm font-semibold">Edit {{ lowerLabel() }}</h3>
      @if (alert(); as kind) {
        @if (kind === 'offline') {
          <app-admin-offline-alert
            #failureAlert
            [description]="alerts.offline.description"
            class="mt-3"
          />
        } @else {
          <app-admin-alert
            #failureAlert
            kind="error"
            [title]="alerts.failed.title"
            [description]="alerts.failed.description"
            class="mt-3"
          />
        }
      }
      <div data-slot="field-group" [class]="fieldGroupClass + ' mt-3'">
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
          [attr.data-invalid]="error() ? 'true' : null"
          [class]="fieldClass"
        >
          <label [for]="ids().input" data-slot="field-label" [class]="labelClass">{{
            spec().label
          }}</label>
          <input
            #field
            [id]="ids().input"
            type="text"
            inputmode="numeric"
            data-slot="input"
            autocomplete="off"
            [formField]="fields.value"
            (blur)="shown.left()"
            [attr.aria-describedby]="
              error() ? ids().description + ' ' + ids().error : ids().description
            "
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.data-invalid]="error() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" [id]="ids().description" [class]="descriptionClass">
            {{ spec().description }}
          </p>
          @if (error(); as error) {
            <div role="alert" data-slot="field-error" [id]="ids().error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
      </div>
      <div class="mt-5 flex flex-wrap gap-2">
        <button
          type="submit"
          appMousePressKeepsFocus
          data-slot="button"
          [class]="primaryButton"
          [class.opacity-50]="!online() && !submitting()"
          [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
        >
          @if (submitting()) {
            <hlm-spinner data-icon="inline-start" />Saving…
          } @else {
            Save changes
          }
        </button>
        <button
          type="button"
          appMousePressKeepsFocus
          data-slot="button"
          [class]="outlineButton"
          (click)="cancel()"
        >
          Cancel
        </button>
      </div>
      <p role="status" class="sr-only">{{ submitting() ? 'Saving the limit.' : '' }}</p>
    </form>
  `,
})
export class LimitEditForm implements OnInit {
  private readonly injector = inject(Injector);
  private destroyed = false;

  readonly spec = input.required<LimitSpec>();
  readonly cancelled = output();
  readonly saved = output<number | null>();

  protected readonly online = injectOnline();
  protected readonly alerts = LIMIT_ALERTS;
  protected readonly lowerLabel = computed(() => this.spec().label.toLowerCase());
  protected readonly ids = computed(() => {
    const base = `edit-${this.spec().id}`;
    return {
      input: base,
      heading: `${base}-heading`,
      description: `${base}-description`,
      error: `${base}-error`,
    };
  });
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;

  private readonly model = signal({ value: '' });
  protected readonly fields = form(this.model);
  private readonly value = computed(() => limitFromText(this.model().value));
  private readonly clientError = computed(() => this.spec().check(this.value()));
  protected readonly shown = new ShownUntilValid(
    () => this.clientError() !== null,
    () => this.fields.value().dirty(),
  );
  private readonly serverError = linkedSignal<string, string | null>({
    source: () => this.model().value,
    computation: () => null,
  });
  protected readonly error = computed(() =>
    this.shown.shown() ? this.clientError() : this.serverError(),
  );
  protected readonly submitting = signal(false);
  protected readonly alert = signal<FormAlert | null>(null);
  readonly saving = this.submitting.asReadonly();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');

  /** Starts from the limit when Edit was pressed, so a live change while the organizer types does not overwrite their text. */
  ngOnInit(): void {
    const current = this.spec().current;
    this.model.set({ value: current === undefined ? '' : String(current) });
    this.focusAfterRender(() => this.field().nativeElement.focus());
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected cancel(): void {
    if (this.submitting()) return;
    this.cancelled.emit();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.alert.set(null);
    this.shown.submitted();
    if (this.clientError() !== null) {
      this.focusAfterRender(() => this.field().nativeElement.focus());
      return;
    }
    if (!this.online()) {
      this.showAlert('offline');
      return;
    }
    const value = this.value() ?? null;
    this.submitting.set(true);
    try {
      await this.spec().save(value);
    } catch (failure) {
      this.submitting.set(false);
      if (!this.destroyed) this.showFailure(failure);
      return;
    }
    this.submitting.set(false);
    if (!this.destroyed) this.saved.emit(value);
  }

  private showFailure(failure: unknown): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const refusal = fieldRefusalOf(failure, this.spec().field);
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

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
