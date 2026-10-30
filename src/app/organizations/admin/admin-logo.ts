import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideImageOff, lucideLoaderCircle } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { checkLogoPick, LOGO_HINT, LOGO_MIME_TYPES } from '../../../../convex/lib/logoFile';
import {
  ConvexOfflineError,
  injectAction,
  injectMutation,
  injectOnline,
} from '../../core/data/convex';
import { OrganizationMark } from '../organization-mark';
import { AdminAlert } from './admin-alert';
import { AdminContext } from './admin-context';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertTexts } from './alert-text';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { DESCRIPTION, FIELD_ERROR } from './field-classes';
import { RemoveLogoDialog, type RemoveOutcome } from './remove-logo-dialog';

type LogoAlert = 'failed' | 'offline';

export const LOGO_ALERTS = {
  failed: {
    title: 'The logo could not be uploaded.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your logo is unchanged. Try again when you're connected.",
  },
} as const satisfies AlertTexts<LogoAlert>;

type Notice = 'saved' | 'removed' | LogoAlert;

const ACCEPT = LOGO_MIME_TYPES.join(',');
const FOCUS_RING =
  'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring';

function logoRefusal(failure: unknown): string | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, message } = data as Record<string, unknown>;
  return field === 'logo' && typeof message === 'string' ? message : null;
}

async function postFile(url: string, file: File): Promise<Id<'_storage'>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error('The upload was not accepted');
  const body = (await response.json()) as { storageId?: unknown };
  if (typeof body.storageId !== 'string') throw new Error('The upload gave no file id');
  return body.storageId as Id<'_storage'>;
}

/**
 * The file input sits before its label, which is drawn as the button, so the keyboard reaches the input and its focus ring shows on the label.
 * A status takes focus after a change, because the pressed control may have changed; the Remove dialog hands focus back through `dismissed`.
 * Only the admin area renders this page, and only once the caller is known to be an org admin of this organization.
 */
@Component({
  selector: 'app-admin-logo',
  imports: [AdminAlert, AdminOfflineAlert, NgIcon, OrganizationMark, RemoveLogoDialog],
  providers: [provideIcons({ lucideCircleAlert, lucideImageOff, lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (organization(); as organization) {
      <section
        aria-labelledby="logo-heading"
        class="mt-6 max-w-xl overflow-clip rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 id="logo-heading" class="font-semibold">Logo</h2>
        </div>
        <div class="px-4 py-4 md:px-5 md:py-5">
          @if (notice(); as notice) {
            @switch (notice) {
              @case ('saved') {
                <app-admin-alert
                  #noticeAlert
                  kind="success"
                  title="Logo saved."
                  description="Your public pages show it within a few minutes."
                  class="mb-5"
                />
              }
              @case ('removed') {
                <app-admin-alert
                  #noticeAlert
                  kind="success"
                  title="Logo removed."
                  description="Your public pages show your initials again within a few minutes."
                  class="mb-5"
                />
              }
              @case ('offline') {
                <app-admin-offline-alert
                  #noticeAlert
                  [description]="alerts.offline.description"
                  class="mb-5"
                />
              }
              @default {
                <app-admin-alert
                  #noticeAlert
                  kind="error"
                  [title]="alerts.failed.title"
                  [description]="alerts.failed.description"
                  class="mb-5"
                />
              }
            }
          }
          <div class="flex items-center gap-4">
            <app-organization-mark
              size="preview"
              [name]="organization.name"
              [logoUrl]="organization.logoUrl"
            />
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="relative inline-flex">
                <input
                  #fileInput
                  id="logo-file"
                  type="file"
                  class="peer sr-only"
                  [accept]="accept"
                  [attr.aria-describedby]="error() ? 'logo-hint logo-error' : 'logo-hint'"
                  [attr.aria-invalid]="error() ? 'true' : null"
                  (click)="pressed($event)"
                  (change)="picked($event)"
                />
                <label
                  for="logo-file"
                  data-slot="button"
                  [class]="uploadClass()"
                  [attr.aria-disabled]="uploading() || !online() ? 'true' : null"
                >
                  @if (uploading()) {
                    <ng-icon
                      name="lucideLoaderCircle"
                      class="motion-safe:animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Uploading…
                  } @else if (organization.logoUrl) {
                    Replace<span class="sr-only"> logo</span>
                  } @else {
                    Upload a logo
                  }
                </label>
              </span>
              @if (organization.logoUrl) {
                <button
                  #removeButton
                  id="logo-remove"
                  type="button"
                  data-slot="button"
                  aria-haspopup="dialog"
                  [class]="removeClass"
                  (click)="remove(organization.organizationId)"
                >
                  Remove<span class="sr-only"> logo</span>
                </button>
              }
            </div>
          </div>
          <p id="logo-hint" data-slot="field-description" [class]="hintClass + ' mt-3'">
            {{ hint }}
          </p>
          @if (error(); as error) {
            <div
              role="alert"
              data-slot="field-error"
              id="logo-error"
              [class]="errorClass + ' mt-2'"
            >
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
          <p role="status" class="sr-only">{{ uploading() ? 'Uploading the logo.' : '' }}</p>
        </div>
      </section>
      <app-remove-logo-dialog (dismissed)="removeDismissed($event)" />
    }
  `,
})
export class AdminLogo {
  private readonly context = inject(AdminContext);
  private readonly injector = inject(Injector);
  private readonly uploadUrl = injectMutation(api.organizations.generateLogoUploadUrl);
  private readonly setLogo = injectAction(api.organizations.setLogo);

  protected readonly organization = this.context.organization;
  protected readonly online = injectOnline();
  protected readonly alerts = LOGO_ALERTS;
  protected readonly accept = ACCEPT;
  protected readonly hint = LOGO_HINT;
  protected readonly hintClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly removeClass = OUTLINE_BUTTON;

  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<Notice | null>(null);

  protected readonly uploadClass = computed(() => {
    const base = this.organization()?.logoUrl ? OUTLINE_BUTTON : PRIMARY_BUTTON;
    const dimmed = !this.online() && !this.uploading() ? ' opacity-50' : '';
    return `${base} ${FOCUS_RING}${dimmed}`;
  });

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly noticeAlert = viewChild<AdminAlert | AdminOfflineAlert>('noticeAlert');
  private readonly removeDialog = viewChild(RemoveLogoDialog);

  /** True while the Remove confirmation is open, so the page behind can be made inert. */
  readonly dialogOpen = computed(() => this.removeDialog()?.isOpen() ?? false);

  /** Stops the file picker from opening when it would lead nowhere. */
  protected pressed(event: Event): void {
    if (this.uploading()) {
      event.preventDefault();
      return;
    }
    if (!this.online()) {
      event.preventDefault();
      this.error.set(null);
      this.show('offline');
    }
  }

  protected async picked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    // Cleared so choosing the same file again, after a fix, still raises a change.
    input.value = '';
    if (!chosen || this.uploading()) return;
    this.notice.set(null);
    this.error.set(null);
    const refusal = checkLogoPick(chosen);
    if (refusal) {
      this.refuse(refusal.message);
      return;
    }
    const organization = this.organization();
    if (!organization) return;
    if (!this.online()) {
      this.show('offline');
      return;
    }
    this.uploading.set(true);
    try {
      const url = await this.uploadUrl.run({ organizationId: organization.organizationId });
      const storageId = await postFile(url, chosen);
      await this.setLogo.run({ organizationId: organization.organizationId, storageId });
    } catch (failure) {
      this.uploading.set(false);
      this.showFailure(failure);
      return;
    }
    this.uploading.set(false);
    this.show('saved');
  }

  protected remove(organizationId: Id<'organizations'>): void {
    this.notice.set(null);
    this.removeDialog()?.open(organizationId);
  }

  /** A removed logo moves focus to the status, because the button that had it is gone; a cancelled dialog puts focus back on Remove. */
  protected removeDismissed(outcome: RemoveOutcome): void {
    if (outcome.removed) {
      this.show('removed');
      return;
    }
    this.focusAfterRender(() => this.removeButton()?.nativeElement.focus());
  }

  private showFailure(failure: unknown): void {
    const refusal = logoRefusal(failure);
    if (refusal) {
      this.refuse(refusal);
      return;
    }
    const offline = failure instanceof ConvexOfflineError || !this.online();
    this.show(offline ? 'offline' : 'failed');
  }

  private refuse(message: string): void {
    this.error.set(message);
    this.focusAfterRender(() => this.fileInput()?.nativeElement.focus());
  }

  private show(notice: Notice): void {
    this.notice.set(notice);
    this.focusAfterRender(() => this.noticeAlert()?.focus());
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
