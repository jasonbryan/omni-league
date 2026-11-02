import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideLoaderCircle, lucideUndo2 } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { checkCityState, CITY_STATE_HINT } from '../../../../convex/lib/organizationInput';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { AdminAlert } from './admin-alert';
import { AdminLogo } from './admin-logo';
import { AdminOfflineAlert } from './admin-offline-alert';
import { AdminContext, bindAdminTitle } from './admin-context';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { DESCRIPTION, FIELD, FIELD_ERROR, FIELD_GROUP, INPUT, LABEL } from './field-classes';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';

type Notice =
  | { kind: 'saved'; previous: string | null }
  | { kind: 'restored' }
  | { kind: 'failed' }
  | { kind: 'offline' }
  | { kind: 'undoFailed'; previous: string | null }
  | { kind: 'undoOffline'; previous: string | null };

function cityStateRefusal(failure: unknown): string | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, message } = data as Record<string, unknown>;
  return field === 'cityState' && typeof message === 'string' ? message : null;
}

/**
 * The status takes focus, because it sits above the field and Save is sticky at the bottom on phones.
 * Only the admin area renders this page, and only once the caller is known to be an org admin of this organization.
 */
@Component({
  selector: 'app-admin-details',
  imports: [
    MousePressKeepsFocus,
    AdminAlert,
    AdminLogo,
    AdminOfflineAlert,
    FormField,
    NgIcon,
    NgTemplateOutlet,
    StickyFooter,
    StickyFooterFocus,
  ],
  providers: [provideIcons({ lucideCircleAlert, lucideLoaderCircle, lucideUndo2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8',
    '[attr.inert]': 'logo()?.dialogOpen() ? "" : null',
  },
  template: `
    @if (organization(); as organization) {
      <div class="min-w-0">
        <p class="text-sm font-medium text-muted-foreground">{{ organization.name }}</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">Details</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
          How your organization appears to players. Changes show on your public page within a few
          minutes.
        </p>
      </div>
      <section
        aria-labelledby="details-heading"
        class="mt-6 max-w-xl overflow-clip rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 id="details-heading" class="font-semibold">Organization details</h2>
        </div>
        <form
          appStickyFooterFocus
          novalidate
          aria-labelledby="details-heading"
          class="px-4 py-4 md:px-5 md:py-5"
          (submit)="submit($event)"
        >
          @if (notice(); as notice) {
            @switch (notice.kind) {
              @case ('saved') {
                <app-admin-alert
                  #noticeAlert
                  kind="success"
                  title="Details saved."
                  description="Your public page and its link previews show them within a few minutes."
                  class="mb-5"
                >
                  <ng-container [ngTemplateOutlet]="undoAction" />
                </app-admin-alert>
              }
              @case ('restored') {
                <app-admin-alert
                  #noticeAlert
                  kind="success"
                  title="Details restored."
                  description="They are back to what they were."
                  class="mb-5"
                />
              }
              @case ('offline') {
                <app-admin-offline-alert
                  #noticeAlert
                  description="Your details are still here. Try again when you're connected."
                  class="mb-5"
                />
              }
              @case ('undoOffline') {
                <app-admin-offline-alert
                  #noticeAlert
                  description="The details are still saved. Try again when you're connected."
                  class="mb-5"
                >
                  <ng-container [ngTemplateOutlet]="undoAction" />
                </app-admin-offline-alert>
              }
              @case ('undoFailed') {
                <app-admin-alert
                  #noticeAlert
                  kind="error"
                  title="The change could not be undone."
                  description="Check your connection and try again."
                  class="mb-5"
                >
                  <ng-container [ngTemplateOutlet]="undoAction" />
                </app-admin-alert>
              }
              @default {
                <app-admin-alert
                  #noticeAlert
                  kind="error"
                  title="The details could not be saved."
                  description="Check your connection and try again."
                  class="mb-5"
                />
              }
            }
          }
          <div data-slot="field-group" [class]="fieldGroupClass + ' ' + clearanceClass">
            <div role="group" data-slot="field" data-orientation="vertical" [class]="fieldClass">
              <label for="name" data-slot="field-label" [class]="labelClass">Name</label>
              <input
                id="name"
                type="text"
                data-slot="input"
                readonly
                autocomplete="off"
                [value]="organization.name"
                [class]="inputClass + ' read-only:bg-muted/50'"
              />
            </div>
            <div
              role="group"
              data-slot="field"
              data-orientation="vertical"
              [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
              [attr.data-invalid]="error() ? 'true' : null"
              [class]="fieldClass"
            >
              <label for="cityState" data-slot="field-label" [class]="labelClass"
                >City, state</label
              >
              <input
                #cityStateInput
                id="cityState"
                type="text"
                data-slot="input"
                autocomplete="off"
                [formField]="fields.cityState"
                (blur)="shown.left()"
                (input)="typed()"
                [attr.aria-describedby]="
                  error() ? 'cityState-description cityState-error' : 'cityState-description'
                "
                [attr.aria-invalid]="error() ? 'true' : null"
                [attr.data-invalid]="error() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="error() ? 'true' : null"
                [class]="inputClass"
              />
              <p
                data-slot="field-description"
                id="cityState-description"
                [class]="descriptionClass"
              >
                {{ hint }}
              </p>
              @if (error(); as error) {
                <div role="alert" data-slot="field-error" id="cityState-error" [class]="errorClass">
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
          <div appStickyFooter>
            <button
              type="submit"
              appMousePressKeepsFocus
              data-slot="button"
              [class]="saveClass"
              [class.opacity-50]="!online() && !saving()"
              [attr.aria-disabled]="saving() || !online() ? 'true' : null"
            >
              @if (saving()) {
                <ng-icon
                  name="lucideLoaderCircle"
                  class="motion-safe:animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />Saving…
              } @else {
                Save
              }
            </button>
          </div>
          <p role="status" class="sr-only">{{ saving() ? 'Saving the details.' : '' }}</p>
        </form>
      </section>
      <app-admin-logo />
    }
    <ng-template #undoAction>
      @if (undoTarget(); as target) {
        <div class="mt-2">
          <button
            type="button"
            data-slot="button"
            [class]="undoClass"
            [class.opacity-50]="!online() && !undoing()"
            [attr.aria-disabled]="undoing() || !online() ? 'true' : null"
            (click)="undo(target.previous)"
          >
            @if (undoing()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />Undoing…
            } @else {
              <ng-icon name="lucideUndo2" data-icon="inline-start" aria-hidden="true" />Undo<span
                class="sr-only"
              >
                saving the details</span
              >
            }
          </button>
        </div>
      }
    </ng-template>
  `,
})
export class AdminDetails {
  private readonly context = inject(AdminContext);
  private readonly injector = inject(Injector);
  private readonly update = injectMutation(api.organizations.updateDetails);

  protected readonly organization = this.context.organization;
  protected readonly online = injectOnline();
  protected readonly hint = CITY_STATE_HINT;
  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly saveClass = `${PRIMARY_BUTTON} w-full`;
  protected readonly undoClass = `${OUTLINE_BUTTON} pointer-coarse:min-h-11 pointer-coarse:px-4`;

  private readonly model = signal({ cityState: this.organization()?.cityState ?? '' });
  protected readonly fields = form(this.model);

  protected readonly saving = signal(false);
  protected readonly undoing = signal(false);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly undoTarget = computed(() => {
    const notice = this.notice();
    return notice && 'previous' in notice ? notice : null;
  });

  private readonly clientError: Signal<string | null> = computed(() => {
    const checked = checkCityState(this.model().cityState);
    return checked.ok ? null : checked.error.message;
  });
  protected readonly shown = new ShownUntilValid(
    () => this.clientError() !== null,
    () => this.fields.cityState().dirty(),
  );
  private readonly serverError = linkedSignal<string, string | null>({
    source: () => this.model().cityState,
    computation: () => null,
  });
  protected readonly error = computed(() =>
    this.shown.shown() ? this.clientError() : this.serverError(),
  );

  private readonly cityStateInput = viewChild<ElementRef<HTMLInputElement>>('cityStateInput');
  protected readonly logo = viewChild(AdminLogo);
  private readonly noticeAlert = viewChild<AdminAlert | AdminOfflineAlert>('noticeAlert');

  constructor() {
    bindAdminTitle('Details');
  }

  /** A status about the value that was saved no longer fits once the user edits it. */
  protected typed(): void {
    const kind = this.notice()?.kind;
    if (kind === 'saved' || kind === 'restored') this.notice.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving() || this.undoing()) return;
    this.notice.set(null);
    this.shown.submitted();
    const checked = checkCityState(this.model().cityState);
    if (!checked.ok) {
      this.focusAfterRender(() => this.cityStateInput()?.nativeElement.focus());
      return;
    }
    const organization = this.organization();
    if (!organization) return;

    const pressedOffline = !this.online();
    if (pressedOffline) {
      this.show({ kind: 'offline' });
      return;
    }
    const previous = organization.cityState ?? null;
    this.saving.set(true);
    try {
      await this.update.run({
        organizationId: organization.organizationId,
        cityState: checked.value,
      });
    } catch (failure) {
      this.saving.set(false);
      this.showFailure(failure);
      return;
    }
    this.saving.set(false);
    this.model.set({ cityState: checked.value ?? '' });
    this.show({ kind: 'saved', previous });
  }

  protected async undo(previous: string | null): Promise<void> {
    if (this.saving() || this.undoing()) return;
    const organization = this.organization();
    if (!organization) return;
    if (!this.online()) {
      this.show({ kind: 'undoOffline', previous });
      return;
    }
    this.undoing.set(true);
    try {
      await this.update.run({ organizationId: organization.organizationId, cityState: previous });
    } catch (failure) {
      this.undoing.set(false);
      this.show(
        failure instanceof ConvexOfflineError
          ? { kind: 'undoOffline', previous }
          : { kind: 'undoFailed', previous },
      );
      return;
    }
    this.undoing.set(false);
    this.model.set({ cityState: previous ?? '' });
    this.show({ kind: 'restored' });
  }

  private showFailure(failure: unknown): void {
    if (failure instanceof ConvexOfflineError) {
      this.show({ kind: 'offline' });
      return;
    }
    const refusal = cityStateRefusal(failure);
    if (refusal) {
      this.serverError.set(refusal);
      this.focusAfterRender(() => this.cityStateInput()?.nativeElement.focus());
      return;
    }
    this.show({ kind: 'failed' });
  }

  private show(notice: Notice): void {
    this.notice.set(notice);
    this.focusAfterRender(() => this.noticeAlert()?.focus());
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
