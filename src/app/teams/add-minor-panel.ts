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
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucidePlus } from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { MousePressKeepsFocus } from '../core/forms/mouse-press-keeps-focus';
import { api, injectMutation, injectOnline } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { PRIMARY_BUTTON } from '../ui/button/button-classes';
import { HlmFieldImports } from '../ui/field';
import { HlmInputImports } from '../ui/input';
import { HlmSpinner } from '../ui/spinner';
import { MinorNameErrorText } from './minor-name-error-text';
import { MinorNameForm } from './minor-name-form';
import { HlmCard } from '../ui/card';

const PANEL = 'overflow-hidden';

export const ADD_MINOR_ALERTS = {
  failed: {
    title: 'The minor could not be added.',
    description: 'Check your connection and try again.',
  },
  offline: { description: 'The name is still here. Try again when you’re connected.' },
  full: { title: 'The team is full.', description: 'Ask the captain to remove a player first.' },
} as const;

@Component({
  selector: 'app-add-minor-panel',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    HlmCard,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinner,
    MinorNameErrorText,
    MousePressKeepsFocus,
    NgIcon,
  ],
  providers: [provideIcons({ lucideCircleAlert, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      id="add-minor"
      aria-labelledby="add-minor-heading"
      hlmCard
      size="bare"
      class="${PANEL}"
    >
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="add-minor-heading" class="font-semibold">Add a minor</h2>
      </div>
      <form
        novalidate
        aria-labelledby="add-minor-heading"
        aria-describedby="add-minor-note"
        class="px-4 py-4 md:px-5 md:py-5"
        (submit)="submit($event)"
      >
        @if (added(); as name) {
          <app-admin-alert
            #status
            kind="success"
            [title]="name + ' was added to ' + teamName() + '.'"
            class="mb-4"
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
        <p id="add-minor-note" class="mb-5 text-sm text-muted-foreground">
          For a child you’re responsible for. Only their name is stored, and you manage their place
          on the roster. Players on other teams see their first name and last initial.
        </p>
        <div hlmFieldGroup>
          <div
            hlmField
            [attr.data-matches-spartan-invalid]="form.error() ? 'true' : null"
            [attr.data-invalid]="form.error() ? 'true' : null"
          >
            <label hlmFieldLabel for="minor-name">Minor’s name</label>
            <input
              hlmInput
              #nameInput
              id="minor-name"
              type="text"
              autocomplete="off"
              [formField]="form.fields.name"
              (blur)="form.left()"
              [attr.aria-describedby]="
                form.error() ? 'minor-name-description minor-name-error' : 'minor-name-description'
              "
              [attr.aria-invalid]="form.error() ? 'true' : null"
              [attr.data-invalid]="form.error() ? 'true' : null"
              [attr.data-matches-spartan-invalid]="form.error() ? 'true' : null"
            />
            <p hlmFieldDescription id="minor-name-description">Up to 60 characters.</p>
            @if (form.error(); as error) {
              <div hlmFieldError id="minor-name-error">
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
        <button
          type="submit"
          appMousePressKeepsFocus
          data-slot="button"
          [class]="primaryButton + ' mt-6 w-full'"
          [class.opacity-50]="!online() && !form.submitting()"
          [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
        >
          @if (form.submitting()) {
            <hlm-spinner data-icon="inline-start" />Adding…
          } @else {
            <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Add minor
          }
        </button>
        <p role="status" class="sr-only">
          {{ form.submitting() ? 'Adding the minor.' : '' }}
        </p>
      </form>
    </section>
  `,
})
export class AddMinorPanel {
  private readonly injector = inject(Injector);
  private readonly addMinor = injectMutation(api.rosterEntries.addMinor);

  readonly teamId = input.required<Id<'teams'>>();
  readonly teamName = input.required<string>();

  protected readonly online = injectOnline();
  protected readonly form = new MinorNameForm();
  protected readonly alerts = ADD_MINOR_ALERTS;
  protected readonly added = signal<string | null>(null);

  protected readonly primaryButton = PRIMARY_BUTTON;

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly status = viewChild<AdminAlert>('status');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    this.added.set(null);
    const teamId = this.teamId();
    const outcome = await this.form.submit(this.online(), (minorName) =>
      this.addMinor.run({ teamId, minorName }),
    );
    if (outcome.sent) {
      this.form.clear();
      this.added.set(outcome.result.minorName);
      this.focusAfterRender(() => this.status()?.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.nameInput()?.nativeElement.focus());
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
