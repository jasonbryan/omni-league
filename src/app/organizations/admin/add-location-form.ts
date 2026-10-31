import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucidePlus } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { FORM_ALERTS, LocationForm } from './location-form';
import { LocationFields } from './location-fields';

@Component({
  selector: 'app-add-location-form',
  imports: [AdminAlert, AdminOfflineAlert, LocationFields, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      aria-labelledby="add-location-heading"
      class="px-4 py-4 md:px-5 md:py-5"
      (submit)="submit($event)"
    >
      @if (added(); as name) {
        <app-admin-alert
          #addedAlert
          kind="success"
          [title]="name + ' added.'"
          description="It’s on your public page now."
          class="mb-5"
        />
      }
      @if (form.alert(); as kind) {
        @if (kind === 'offline') {
          <app-admin-offline-alert
            #failureAlert
            [description]="alerts.offline.description"
            class="mb-5"
          />
        } @else {
          <app-admin-alert
            #failureAlert
            kind="error"
            [title]="alerts[kind].title"
            [description]="alerts[kind].description"
            class="mb-5"
          />
        }
      }
      <app-location-fields
        #locationFields
        [fields]="form.fields"
        [errors]="form.errors"
        [descriptions]="descriptions"
        (fieldLeft)="form.left($event)"
      />
      <button
        #submitButton
        type="submit"
        data-slot="button"
        [class]="buttonClass"
        [class.opacity-50]="!online() && !form.submitting()"
        [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
      >
        @if (form.submitting()) {
          <ng-icon
            name="lucideLoaderCircle"
            class="motion-safe:animate-spin"
            data-icon="inline-start"
            aria-hidden="true"
          />Adding location…
        } @else {
          <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Add location
        }
      </button>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Adding the location.' : '' }}</p>
    </form>
  `,
})
export class AddLocationForm {
  private readonly injector = inject(Injector);
  private readonly create = injectMutation(api.locations.create);

  readonly organizationId = input.required<Id<'organizations'>>();

  protected readonly online = injectOnline();
  protected readonly form = new LocationForm({ name: '', address: '' });
  protected readonly alerts = FORM_ALERTS;
  protected readonly buttonClass = `${PRIMARY_BUTTON} mt-6 w-full`;
  protected readonly descriptions = {
    name: 'For example, the park or beach. Up to 100 characters.',
    address:
      'Street, city, state, and ZIP code, so visitors can find it on a map. Up to 200 characters.',
  };

  protected readonly added = signal<string | null>(null);

  private readonly locationFields = viewChild.required<LocationFields>('locationFields');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    this.added.set(null);
    const organizationId = this.organizationId();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.create.run({ organizationId, ...values }),
    );
    if (outcome.sent) {
      this.added.set(outcome.values.name);
      this.form.clear();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.locationFields().focus(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
