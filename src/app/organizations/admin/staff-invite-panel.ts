import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
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
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, injectAction, injectOnline } from '../../core/data/convex';
import { Checkbox } from '../../ui/checkbox';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  DESCRIPTION,
  FIELD,
  FIELD_CONTENT,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_HORIZONTAL,
  FIELD_SET,
  INPUT,
  LABEL,
  LEGEND,
  RADIO_EDGE,
  RADIO_INDICATOR,
  RADIO_INPUT,
  RADIO_ITEM,
} from './field-classes';
import { INVITE_FORM_ALERTS, InviteForm, type InviteField } from './invite-form';
import { formatDay } from './format-day';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';

export interface InviteLeagueChoice {
  leagueId: Id<'leagues'>;
  name: string;
}

interface CreatedInvite {
  email: string;
  expiresAt: number;
  link: string;
}

type CopyOutcome = 'copied' | 'blocked' | null;

const TEXTAREA =
  'border-input dark:bg-input/30 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full disabled:cursor-not-allowed disabled:opacity-50 resize-none font-mono break-all';

/** The token lives only in this component's signal: it is shown once, never stored, logged, or put in the address. */
@Component({
  selector: 'app-staff-invite-panel',
  imports: [MousePressKeepsFocus, AdminAlert, AdminOfflineAlert, Checkbox, FormField, NgIcon],
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
      <section
        id="invite"
        #section
        aria-labelledby="invite-link-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
          <h2 #linkHeading id="invite-link-heading" tabindex="-1" class="font-semibold rounded-sm">
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
              class="flex items-center select-none gap-2 text-sm font-medium leading-snug w-fit"
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
            class="mt-2 flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground"
          >
            @if (copied() === 'copied') {
              <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />Link
              copied.
            } @else if (copied() === 'blocked') {
              Couldn’t copy. Select the link and copy it.
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
      <section
        id="invite"
        #section
        aria-labelledby="invite-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div
          class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
        >
          <h2 id="invite-heading" class="font-semibold">Invite staff</h2>
        </div>
        @if (leagues(); as leagues) {
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
                  [title]="alerts[kind].title"
                  [description]="alerts[kind].description"
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
                [attr.data-matches-spartan-invalid]="form.errors.email() ? 'true' : null"
                [attr.data-invalid]="form.errors.email() ? 'true' : null"
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
                  (blur)="form.left('email')"
                  [attr.aria-describedby]="
                    form.errors.email() ? 'email-description email-error' : 'email-description'
                  "
                  [attr.aria-invalid]="form.errors.email() ? 'true' : null"
                  [attr.data-invalid]="form.errors.email() ? 'true' : null"
                  [attr.data-matches-spartan-invalid]="form.errors.email() ? 'true' : null"
                  [class]="inputClass"
                />
                <p data-slot="field-description" id="email-description" [class]="descriptionClass">
                  Only an account with this email address can accept the invite.
                </p>
                @if (form.errors.email(); as error) {
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
              <fieldset id="role" data-slot="field-set" [class]="fieldSetClass">
                <legend data-slot="field-legend" data-variant="label" [class]="legendClass">
                  Role
                </legend>
                <div data-slot="radio-group" class="grid gap-3">
                  <div
                    role="group"
                    data-slot="field"
                    data-orientation="horizontal"
                    [class]="fieldHorizontalClass"
                  >
                    <span
                      data-slot="radio-group-item"
                      [attr.data-checked]="form.role() === 'leagueOrganizer' ? 'true' : null"
                      [class]="radioItemClass + ' ' + radioEdgeClass"
                      [class.opacity-50]="!form.canChooseOrganizer()"
                      ><input
                        type="radio"
                        id="role-organizer"
                        name="role"
                        value="leagueOrganizer"
                        [checked]="form.role() === 'leagueOrganizer'"
                        [disabled]="!form.canChooseOrganizer()"
                        [attr.aria-describedby]="
                          form.canChooseOrganizer()
                            ? 'role-organizer-description'
                            : 'role-organizer-description role-unavailable'
                        "
                        (change)="form.chosenRole.set('leagueOrganizer')"
                        [class]="radioInputClass" /><span
                        aria-hidden="true"
                        [class]="radioIndicatorClass"
                      ></span
                    ></span>
                    <div data-slot="field-content" [class]="contentClass">
                      <label
                        for="role-organizer"
                        data-slot="field-label"
                        [class]="labelClass"
                        [class.opacity-50]="!form.canChooseOrganizer()"
                        >League organizer</label
                      >
                      <p
                        data-slot="field-description"
                        id="role-organizer-description"
                        [class]="descriptionClass"
                      >
                        Runs only the leagues you choose.
                      </p>
                    </div>
                  </div>
                  <div
                    role="group"
                    data-slot="field"
                    data-orientation="horizontal"
                    [class]="fieldHorizontalClass"
                  >
                    <span
                      data-slot="radio-group-item"
                      [attr.data-checked]="form.role() === 'orgAdmin' ? 'true' : null"
                      [class]="radioItemClass + ' ' + radioEdgeClass"
                      ><input
                        type="radio"
                        id="role-admin"
                        name="role"
                        value="orgAdmin"
                        [checked]="form.role() === 'orgAdmin'"
                        aria-describedby="role-admin-description"
                        (change)="form.chosenRole.set('orgAdmin')"
                        [class]="radioInputClass" /><span
                        aria-hidden="true"
                        [class]="radioIndicatorClass"
                      ></span
                    ></span>
                    <div data-slot="field-content" [class]="contentClass">
                      <label for="role-admin" data-slot="field-label" [class]="labelClass"
                        >Org admin</label
                      >
                      <p
                        data-slot="field-description"
                        id="role-admin-description"
                        [class]="descriptionClass"
                      >
                        Manages everything in {{ organizationName() }}, including staff.
                      </p>
                    </div>
                  </div>
                </div>
                @if (!form.canChooseOrganizer()) {
                  <p data-slot="field-description" id="role-unavailable" [class]="descriptionClass">
                    Create a league first to invite a league organizer.
                  </p>
                }
              </fieldset>
              @if (form.role() === 'leagueOrganizer') {
                <fieldset
                  id="leagues"
                  data-slot="field-set"
                  [attr.aria-describedby]="
                    form.errors.leagues()
                      ? 'leagues-description leagues-error'
                      : 'leagues-description'
                  "
                  [attr.data-invalid]="form.errors.leagues() ? 'true' : null"
                  (focusout)="form.leftGroup('leagues', $event)"
                  [class]="fieldSetClass"
                >
                  <legend
                    data-slot="field-legend"
                    data-variant="label"
                    [class]="legendClass + (form.errors.leagues() ? ' text-destructive' : '')"
                  >
                    Leagues
                  </legend>
                  <p
                    data-slot="field-description"
                    id="leagues-description"
                    [class]="descriptionClass + ' -mt-1.5'"
                  >
                    Choose one or more.
                  </p>
                  <div data-slot="checkbox-group" class="grid gap-3">
                    @for (league of leagues; track league.leagueId; let i = $index) {
                      <div
                        role="group"
                        data-slot="field"
                        data-orientation="horizontal"
                        [attr.data-matches-spartan-invalid]="form.errors.leagues() ? 'true' : null"
                        [class]="fieldHorizontalClass"
                      >
                        <app-checkbox
                          [controlId]="'league-' + (i + 1)"
                          [checked]="form.selected().has(league.leagueId)"
                          (checkedChange)="form.toggleLeague(league.leagueId, $event)"
                          [showInvalid]="!!form.errors.leagues()"
                        />
                        <div data-slot="field-content" [class]="contentClass">
                          <label
                            [attr.for]="'league-' + (i + 1)"
                            data-slot="field-label"
                            [class]="labelClass"
                            >{{ league.name }}</label
                          >
                        </div>
                      </div>
                    }
                  </div>
                  @if (form.errors.leagues(); as error) {
                    <div
                      role="alert"
                      data-slot="field-error"
                      id="leagues-error"
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
                </fieldset>
              }
            </div>
            <button
              #submitButton
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
                <ng-icon name="lucideLink" data-icon="inline-start" aria-hidden="true" />Create
                invite link
              }
            </button>
            <p role="status" class="sr-only">
              {{ form.submitting() ? 'Creating the invite link.' : '' }}
            </p>
          </form>
        } @else if (leaguesFailed()) {
          <div class="px-4 py-4 md:px-5">
            <app-admin-alert
              kind="error"
              title="The leagues could not be loaded."
              description="Check your connection and try again."
            />
          </div>
        } @else {
          <p role="status" class="sr-only">Loading the leagues.</p>
        }
      </section>
    }
  `,
})
export class StaffInvitePanel {
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly createInvite = injectAction(api.invites.create);

  readonly organizationId = input.required<Id<'organizations'>>();
  readonly organizationName = input.required<string>();
  readonly leagues = input<readonly InviteLeagueChoice[] | undefined>();
  readonly leaguesFailed = input(false);

  protected readonly online = injectOnline();
  protected readonly form = new InviteForm(() => (this.leagues() ?? []).map((l) => l.leagueId));
  protected readonly alerts = INVITE_FORM_ALERTS;

  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly fieldClass = FIELD;
  protected readonly fieldHorizontalClass = FIELD_HORIZONTAL;
  protected readonly fieldSetClass = FIELD_SET;
  protected readonly legendClass = LEGEND;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly contentClass = FIELD_CONTENT;
  protected readonly radioItemClass = RADIO_ITEM;
  protected readonly radioEdgeClass = RADIO_EDGE;
  protected readonly radioInputClass = RADIO_INPUT;
  protected readonly radioIndicatorClass = RADIO_INDICATOR;
  protected readonly textareaClass = TEXTAREA;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly day = formatDay;

  protected readonly created = signal<CreatedInvite | null>(null);
  protected readonly copied = signal<CopyOutcome>(null);

  private readonly pendingFocusRequest = signal<{ readonly from: Element | null } | null>(null);

  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('email');
  private readonly leagueBoxes = viewChildren(Checkbox);
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly linkHeading = viewChild<ElementRef<HTMLElement>>('linkHeading');

  constructor() {
    effect(() => {
      const request = this.pendingFocusRequest();
      if (!request) return;
      const email = this.emailInput();
      if (email) {
        this.pendingFocusRequest.set(null);
        // Focus moved since the press (Revoke, the menu sheet): leave it there.
        if (this.document.activeElement !== request.from) return;
        // Not `preventScroll`: the form grew the section after the jump, so Email may be below it.
        email.nativeElement.focus();
      } else if (this.leaguesFailed()) {
        // The leagues did not load, so there is no form to focus; do not steal focus later.
        this.pendingFocusRequest.set(null);
      }
    });
  }

  /** While the leagues load there is no form yet, so the request waits and Email takes focus when the form renders. */
  focusFirst(): void {
    const target = this.emailInput() ?? this.linkHeading();
    if (target) target.nativeElement.focus({ preventScroll: true });
    else this.pendingFocusRequest.set({ from: this.document.activeElement });
  }

  scrollTarget(): HTMLElement | undefined {
    return this.section()?.nativeElement;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    const organizationId = this.organizationId();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.createInvite.run({ organizationId, ...values }),
    );
    if (outcome.sent) {
      const { email } = outcome.values;
      const { token, expiresAt } = outcome.result;
      this.copied.set(null);
      this.created.set({ email, expiresAt, link: this.linkFor(token) });
      this.focusAfterRender(() => this.linkHeading()?.nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  /** `<origin>/invites/accept#<token>`: the token stays in the fragment. */
  private linkFor(token: string): string {
    return `${this.document.location.origin}/invites/accept#${token}`;
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

  private focusField(field: InviteField): void {
    if (field === 'email') this.emailInput()?.nativeElement.focus();
    else this.leagueBoxes()[0]?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
