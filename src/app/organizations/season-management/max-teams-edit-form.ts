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
import { lucideCircleAlert, lucideLoaderCircle } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import { checkMaxTeams, maxTeamsFromText } from '../../../../convex/lib/seasonInput';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../admin/button-classes';
import { DESCRIPTION, FIELD, FIELD_ERROR, FIELD_GROUP, INPUT, LABEL } from '../admin/field-classes';
import { MAX_TEAMS_ALERTS, maxTeamsDescription } from './max-teams-text';

type FormAlert = 'offline' | 'failed';

function fieldRefusalOf(failure: unknown): string | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, message } = data as Record<string, unknown>;
  return field === 'maxTeams' && typeof message === 'string' ? message : null;
}

@Component({
  selector: 'app-max-teams-edit-form',
  imports: [AdminAlert, AdminOfflineAlert, FormField, MousePressKeepsFocus, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      aria-labelledby="edit-maximum-teams-heading"
      (submit)="save($event)"
      (keydown.escape)="cancel()"
    >
      <h3 id="edit-maximum-teams-heading" class="text-sm font-semibold">Edit maximum teams</h3>
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
          <label for="edit-maximum-teams" data-slot="field-label" [class]="labelClass"
            >Maximum teams</label
          >
          <input
            #field
            id="edit-maximum-teams"
            type="text"
            inputmode="numeric"
            data-slot="input"
            autocomplete="off"
            [formField]="fields.maxTeams"
            (blur)="shown.left()"
            [attr.aria-describedby]="
              error()
                ? 'edit-maximum-teams-description edit-maximum-teams-error'
                : 'edit-maximum-teams-description'
            "
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.data-invalid]="error() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
            [class]="inputClass"
          />
          <p
            data-slot="field-description"
            id="edit-maximum-teams-description"
            [class]="descriptionClass"
          >
            {{ description() }}
          </p>
          @if (error(); as error) {
            <div
              role="alert"
              data-slot="field-error"
              id="edit-maximum-teams-error"
              [class]="errorClass"
            >
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
            <ng-icon
              name="lucideLoaderCircle"
              class="motion-safe:animate-spin"
              data-icon="inline-start"
              aria-hidden="true"
            />Saving…
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
export class MaxTeamsEditForm implements OnInit {
  private readonly injector = inject(Injector);
  private readonly setMaxTeams = injectMutation(api.seasons.setMaxTeams);
  private destroyed = false;

  readonly seasonId = input.required<Id<'seasons'>>();
  readonly maxTeams = input<number | undefined>(undefined);
  readonly teamCount = input.required<number>();
  readonly cancelled = output();
  readonly saved = output<number | null>();

  protected readonly online = injectOnline();
  protected readonly alerts = MAX_TEAMS_ALERTS;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;

  private readonly model = signal({ maxTeams: '' });
  protected readonly fields = form(this.model);
  private readonly value = computed(() => maxTeamsFromText(this.model().maxTeams));
  private readonly clientError = computed(() => checkMaxTeams(this.value())?.message ?? null);
  protected readonly shown = new ShownUntilValid(
    () => this.clientError() !== null,
    () => this.fields.maxTeams().dirty(),
  );
  private readonly serverError = linkedSignal<string, string | null>({
    source: () => this.model().maxTeams,
    computation: () => null,
  });
  protected readonly error = computed(() =>
    this.shown.shown() ? this.clientError() : this.serverError(),
  );
  protected readonly description = computed(() => maxTeamsDescription(this.teamCount()));
  protected readonly submitting = signal(false);
  protected readonly alert = signal<FormAlert | null>(null);
  readonly saving = this.submitting.asReadonly();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');

  /** Starts from the limit when Edit was pressed, so a live change while the organizer types does not overwrite their text. */
  ngOnInit(): void {
    const maxTeams = this.maxTeams();
    this.model.set({ maxTeams: maxTeams === undefined ? '' : String(maxTeams) });
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
    const maxTeams = this.value() ?? null;
    this.submitting.set(true);
    try {
      await this.setMaxTeams.run({ seasonId: this.seasonId(), maxTeams });
    } catch (failure) {
      this.submitting.set(false);
      if (!this.destroyed) this.showFailure(failure);
      return;
    }
    this.submitting.set(false);
    if (!this.destroyed) this.saved.emit(maxTeams);
  }

  private showFailure(failure: unknown): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const refusal = fieldRefusalOf(failure);
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
