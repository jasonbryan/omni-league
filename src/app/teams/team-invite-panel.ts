import { DOCUMENT } from '@angular/common';
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
import {
  lucideCheck,
  lucideCircleAlert,
  lucideCopy,
  lucideLink,
  lucideLoaderCircle,
  lucideUserPlus,
} from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { teamInviteLink } from '../../../convex/lib/teamInviteInput';
import { MousePressKeepsFocus } from '../core/forms/mouse-press-keeps-focus';
import { api, injectAction, injectOnline } from '../core/data/convex';
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
import { formatDay } from '../organizations/admin/format-day';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { TEAM_INVITE_FORM_ALERTS, TeamInviteForm } from './team-invite-form';

interface CreatedInvite {
  email: string;
  expiresAt: number;
  link: string;
}

type CopyOutcome = 'copied' | 'blocked' | null;

const PANEL =
  'overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';
const TEXTAREA =
  'border-input dark:bg-input/30 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full disabled:cursor-not-allowed disabled:opacity-50 resize-none font-mono break-all';

/** The token lives only in this component's signal: it is shown once, never stored, logged, or put in the address. */
@Component({
  selector: 'app-team-invite-panel',
  imports: [AdminAlert, AdminOfflineAlert, FormField, MousePressKeepsFocus, NgIcon],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleAlert,
      lucideCopy,
      lucideLink,
      lucideLoaderCircle,
      lucideUserPlus,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (created(); as invite) {
      <section id="invite" #section aria-labelledby="invite-link-heading" class="${PANEL}">
        <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
          <h2 #linkHeading id="invite-link-heading" tabindex="-1" class="rounded-sm font-semibold">
            Invite link ready
          </h2>
        </div>
        <div class="px-4 py-4 md:px-5 md:py-5">
          <p class="text-sm">
            Send this link to
            <strong class="font-semibold break-all">{{ invite.email }}</strong>
            yourself, by email or text. It works until {{ day(invite.expiresAt) }}.
          </p>
          <app-admin-alert
            kind="note"
            title="This is the only time the link is shown."
            description="If it’s lost, revoke the invite and create a new one."
            class="mt-4"
          />
          <div
            role="group"
            data-slot="field"
            data-orientation="vertical"
            [class]="fieldClass + ' mt-5'"
          >
            <label
              for="invite-link"
              data-slot="field-label"
              class="flex w-fit items-center gap-2 text-sm leading-snug font-medium select-none"
              >Invite link</label
            >
            <textarea
              id="invite-link"
              readonly
              rows="3"
              spellcheck="false"
              aria-describedby="copy-status"
              data-slot="textarea"
              [class]="textareaClass"
              [value]="invite.link"
            ></textarea>
          </div>
          <button
            type="button"
            data-slot="button"
            aria-describedby="copy-status"
            [class]="primaryButton + ' mt-3 w-full'"
            (click)="copy(invite.link)"
          >
            @if (copied() === 'copied') {
              <ng-icon name="lucideCheck" data-icon="inline-start" aria-hidden="true" />Copied
            } @else {
              <ng-icon name="lucideCopy" data-icon="inline-start" aria-hidden="true" />Copy link
            }
          </button>
          <p
            id="copy-status"
            role="status"
            class="mt-2 flex min-h-5 items-center gap-1.5 text-sm"
            [class.text-muted-foreground]="copied() !== 'blocked'"
            [class.text-destructive]="copied() === 'blocked'"
          >
            @if (copied() === 'copied') {
              <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />Link
              copied.
            } @else if (copied() === 'blocked') {
              <ng-icon
                name="lucideCircleAlert"
                class="shrink-0 text-base"
                aria-hidden="true"
              />Couldn’t copy. Select the link and copy it.
            }
          </p>
          <button
            type="button"
            data-slot="button"
            [class]="outlineButton + ' mt-3 w-full'"
            (click)="another()"
          >
            <ng-icon name="lucideUserPlus" data-icon="inline-start" aria-hidden="true" />Invite
            someone else
          </button>
        </div>
      </section>
    } @else {
      <section id="invite" #section aria-labelledby="invite-heading" class="${PANEL}">
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 id="invite-heading" class="font-semibold">Invite players</h2>
        </div>
        <form
          novalidate
          aria-labelledby="invite-heading"
          aria-describedby="invite-note"
          class="px-4 py-4 md:px-5 md:py-5"
          (submit)="submit($event)"
        >
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
                [title]="alerts.failed.title"
                [description]="alerts.failed.description"
                class="mb-5"
              />
            }
          }
          <p id="invite-note" class="mb-5 text-sm text-muted-foreground">
            Omni League doesn’t email invites yet. You’ll get a link to send them yourself.
          </p>
          <div data-slot="field-group" [class]="fieldGroupClass">
            <div
              role="group"
              data-slot="field"
              data-orientation="vertical"
              [attr.data-matches-spartan-invalid]="form.error() ? 'true' : null"
              [attr.data-invalid]="form.error() ? 'true' : null"
              [class]="fieldClass"
            >
              <label for="email" data-slot="field-label" [class]="labelClass">Email</label>
              <input
                #email
                id="email"
                type="email"
                data-slot="input"
                autocomplete="off"
                spellcheck="false"
                autocapitalize="none"
                [formField]="form.fields.email"
                (blur)="form.left()"
                [attr.aria-describedby]="
                  form.error() ? 'email-description email-error' : 'email-description'
                "
                [attr.aria-invalid]="form.error() ? 'true' : null"
                [attr.data-invalid]="form.error() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.error() ? 'true' : null"
                [class]="inputClass"
              />
              <p data-slot="field-description" id="email-description" [class]="descriptionClass">
                Only an account with this email address can accept. A pending invite doesn’t count
                toward the roster.
              </p>
              @if (form.error(); as error) {
                <div role="alert" data-slot="field-error" id="email-error" [class]="errorClass">
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
          <button
            type="submit"
            appMousePressKeepsFocus
            data-slot="button"
            [class]="primaryButton + ' mt-6 w-full'"
            [class.opacity-50]="!online() && !form.submitting()"
            [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
          >
            @if (form.submitting()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />Creating invite link…
            } @else {
              <ng-icon name="lucideLink" data-icon="inline-start" aria-hidden="true" />Create invite
              link
            }
          </button>
          <p role="status" class="sr-only">
            {{ form.submitting() ? 'Creating the invite link.' : '' }}
          </p>
        </form>
      </section>
    }
  `,
})
export class TeamInvitePanel {
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly createInvite = injectAction(api.teamInvites.create);

  readonly teamId = input.required<Id<'teams'>>();

  protected readonly online = injectOnline();
  protected readonly form = new TeamInviteForm();
  protected readonly alerts = TEAM_INVITE_FORM_ALERTS;

  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly textareaClass = TEXTAREA;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly day = formatDay;

  protected readonly created = signal<CreatedInvite | null>(null);
  protected readonly copied = signal<CopyOutcome>(null);

  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('email');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly linkHeading = viewChild<ElementRef<HTMLElement>>('linkHeading');

  focusFirst(): void {
    (this.emailInput() ?? this.linkHeading())?.nativeElement.focus({ preventScroll: true });
  }

  scrollTarget(): HTMLElement | undefined {
    return this.section()?.nativeElement;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    const teamId = this.teamId();
    const outcome = await this.form.submit(this.online(), (email) =>
      this.createInvite.run({ teamId, email }),
    );
    if (outcome.sent) {
      const { token, expiresAt } = outcome.result;
      const link = teamInviteLink(this.document.location.origin, token);
      this.copied.set(null);
      this.created.set({ email: outcome.email, expiresAt, link });
      this.focusAfterRender(() => this.linkHeading()?.nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.emailInput()?.nativeElement.focus());
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  protected async copy(link: string): Promise<void> {
    try {
      const clipboard = this.document.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error('No clipboard');
      await clipboard.writeText(link);
      this.copied.set('copied');
    } catch {
      this.copied.set('blocked');
    }
  }

  protected another(): void {
    this.created.set(null);
    this.copied.set(null);
    this.form.clear();
    this.focusAfterRender(() => this.emailInput()?.nativeElement.focus());
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
