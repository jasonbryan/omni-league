import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  type OnInit,
  output,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { MousePressKeepsFocus } from '../core/forms/mouse-press-keeps-focus';
import { api, injectMutation, injectOnline } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import {
  DESCRIPTION,
  FIELD,
  FIELD_ERROR,
  FIELD_GROUP,
  INPUT,
  LABEL,
} from '../organizations/admin/field-classes';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { HlmSpinner } from '../ui/spinner';
import { MinorNameErrorText } from './minor-name-error-text';
import { MinorNameForm } from './minor-name-form';

export const RENAME_MINOR_ALERTS = {
  failed: {
    title: 'The name could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: { description: 'The name is still here. Try again when you’re connected.' },
} as const;

export interface RenameMinorOutcome {
  rosterEntryId: Id<'rosterEntries'>;
  /** Null when the form was cancelled. */
  renamed: string | null;
}

@Component({
  selector: 'app-rename-minor-form',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    HlmSpinner,
    MinorNameErrorText,
    MousePressKeepsFocus,
    NgIcon,
  ],
  providers: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form novalidate aria-labelledby="rename-heading" (submit)="submit($event)">
      <h3 id="rename-heading" class="text-sm font-semibold">Rename {{ currentName() }}</h3>
      @if (form.alert(); as kind) {
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
          [attr.data-matches-spartan-invalid]="form.error() ? 'true' : null"
          [attr.data-invalid]="form.error() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="rename-name" data-slot="field-label" [class]="labelClass">Minor’s name</label>
          <input
            #nameInput
            id="rename-name"
            type="text"
            data-slot="input"
            autocomplete="off"
            [formField]="form.fields.name"
            (blur)="form.left()"
            [attr.aria-describedby]="
              form.error() ? 'rename-name-description rename-name-error' : 'rename-name-description'
            "
            [attr.aria-invalid]="form.error() ? 'true' : null"
            [attr.data-invalid]="form.error() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.error() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="rename-name-description" [class]="descriptionClass">
            Up to 60 characters.
          </p>
          @if (form.error(); as error) {
            <div role="alert" data-slot="field-error" id="rename-name-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <app-minor-name-error-text [error]="error" />
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
          [class.opacity-50]="!online() && !form.submitting()"
          [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
        >
          @if (form.submitting()) {
            <hlm-spinner data-icon="inline-start" />Saving…
          } @else {
            Save name
          }
        </button>
        <button
          type="button"
          data-slot="button"
          [class]="outlineButton"
          [attr.aria-disabled]="form.submitting() ? 'true' : null"
          (click)="cancel()"
        >
          Cancel
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Saving the name.' : '' }}</p>
    </form>
  `,
})
export class RenameMinorForm implements OnInit {
  private readonly injector = inject(Injector);
  private readonly renameMinor = injectMutation(api.rosterEntries.renameMinor);

  readonly rosterEntryId = input.required<Id<'rosterEntries'>>();
  readonly currentName = input.required<string>();
  readonly done = output<RenameMinorOutcome>();

  protected readonly online = injectOnline();
  protected readonly form = new MinorNameForm();
  protected readonly alerts = RENAME_MINOR_ALERTS;

  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');

  constructor() {
    afterNextRender(() => this.nameInput()?.nativeElement.focus());
  }

  ngOnInit(): void {
    this.form.model.set({ name: this.currentName() });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    const rosterEntryId = this.rosterEntryId();
    const outcome = await this.form.submit(this.online(), (minorName) =>
      this.renameMinor.run({ rosterEntryId, minorName }),
    );
    if (outcome.sent) {
      this.done.emit({ rosterEntryId, renamed: outcome.result.minorName });
    } else if ('focus' in outcome) {
      afterNextRender(() => this.nameInput()?.nativeElement.focus(), { injector: this.injector });
    } else {
      afterNextRender(() => this.failureAlert()?.focus(), { injector: this.injector });
    }
  }

  protected cancel(): void {
    if (this.form.submitting()) return;
    this.done.emit({ rosterEntryId: this.rosterEntryId(), renamed: null });
  }
}
