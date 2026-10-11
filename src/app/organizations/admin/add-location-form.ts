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
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from './admin-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { FORM_ALERTS, LocationForm } from './location-form';
import { LocationFields } from './location-fields';

/**
 * The add form of the Locations page (#65; design/mockups/65-organization-admin-locations.html,
 * states 7 and 9 to 12), inside the page's `#add-location` section. Errors show after a submit,
 * under their field; focus goes to the first invalid field, or to the form alert for a failure
 * that is not about one field. On success "<name> added." and "It’s on your public page now."
 * appear in a status above the fields, the fields clear, and focus stays on the button. The page's
 * live list shows the new row. Like every form that calls a mutation it carries the offline
 * refusal of design/mockups/88-offline-note.html (angular.md, State and data).
 */
@Component({
  selector: 'app-add-location-form',
  imports: [AdminAlert, LocationFields, NgIcon],
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
        <app-admin-alert
          #failureAlert
          [kind]="kind === 'offline' ? 'offline' : 'error'"
          [title]="alerts[kind].title"
          [description]="alerts[kind].description"
          class="mb-5"
        />
      }
      <app-location-fields
        #locationFields
        [fields]="form.fields"
        [errors]="form.errors"
        [descriptions]="descriptions"
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

  /** The name just added, for the status above the fields; cleared by the next press. */
  protected readonly added = signal<string | null>(null);

  private readonly locationFields = viewChild.required<LocationFields>('locationFields');
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
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
