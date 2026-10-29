import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  inject,
  input,
  type OnInit,
  output,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle } from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { FORM_ALERTS, LocationForm } from './location-form';
import { LocationFields } from './location-fields';

export interface AdminLocation {
  locationId: Id<'locations'>;
  name: string;
  address: string;
}

@Component({
  selector: 'app-location-edit-form',
  imports: [AdminAlert, AdminOfflineAlert, LocationFields, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      aria-labelledby="edit-heading"
      (submit)="save($event)"
      (keydown.escape)="cancel()"
    >
      <h3 id="edit-heading" class="text-sm font-semibold">Edit location</h3>
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
            [title]="alerts[kind].title"
            [description]="alerts[kind].description"
            class="mt-3"
          />
        }
      }
      <app-location-fields
        #locationFields
        idPrefix="edit-"
        class="mt-3"
        [fields]="form.fields"
        [errors]="form.errors"
        [descriptions]="descriptions"
        (fieldLeft)="form.left($event)"
      />
      <div class="mt-5 flex flex-wrap gap-2">
        <button
          type="submit"
          data-slot="button"
          [class]="primaryButton"
          [class.opacity-50]="!online() && !form.submitting()"
          [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
        >
          @if (form.submitting()) {
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
        <button type="button" data-slot="button" [class]="outlineButton" (click)="cancel()">
          Cancel
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Saving the location.' : '' }}</p>
    </form>
  `,
})
export class LocationEditForm implements OnInit {
  private readonly injector = inject(Injector);
  private destroyed = false;
  private readonly update = injectMutation(api.locations.update);

  readonly location = input.required<AdminLocation>();
  readonly cancelled = output();
  readonly saved = output<string>();

  protected readonly online = injectOnline();
  protected readonly alerts = FORM_ALERTS;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly descriptions = {
    name: 'Up to 100 characters.',
    address: 'Up to 200 characters.',
  };
  protected readonly form = new LocationForm({ name: '', address: '' });
  readonly saving = this.form.submitting.asReadonly();

  private readonly locationFields = viewChild.required<LocationFields>('locationFields');
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');

  /**
   * Inputs are bound after construction, so this starts from the values at the moment Edit was pressed, not in a field initializer.
   * A live change to the row while the user types does not overwrite their text.
   */
  ngOnInit(): void {
    const { name, address } = this.location();
    this.form.model.set({ name, address });
    afterNextRender(() => this.locationFields().focus('name'), { injector: this.injector });
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected cancel(): void {
    if (this.form.submitting()) return;
    this.cancelled.emit();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    const { locationId } = this.location();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.update.run({ locationId, ...values }),
    );
    if (this.destroyed) return;
    if (outcome.sent) {
      this.saved.emit(outcome.values.name);
    } else if ('focus' in outcome) {
      afterNextRender(() => this.locationFields().focus(outcome.focus), {
        injector: this.injector,
      });
    } else {
      afterNextRender(() => this.failureAlert()?.focus(), { injector: this.injector });
    }
  }
}
