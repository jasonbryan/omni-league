import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideCircleAlert,
  lucideGlobe,
  lucideLoaderCircle,
  lucidePlus,
} from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { SEASON_MESSAGES } from '../../../../convex/lib/seasonInput';
import { formatLabel } from '../../../../convex/lib/divisions';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../admin/button-classes';
import { CREATED_STATUS, CREATED_TITLE } from '../admin/footer-status';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from '../admin/sticky-footer';
import { StickyFooterFocus } from '../admin/sticky-footer-focus';
import { DESCRIPTION, FIELD, FIELD_ERROR, FIELD_GROUP, INPUT, LABEL } from '../admin/field-classes';
import type { OrganizerLeague } from './league-context';
import { SEASON_FORM_ALERTS, SeasonForm, type SeasonField } from './season-form';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';

const NOT_SET = 'Not set yet';

export interface CreatedSeason {
  seasonId: Id<'seasons'>;
  name: string;
  slug: string;
  registrationDeadline: string;
}

export interface SeasonShown {
  event: MouseEvent;
  slug: string;
}

const DATE_FIELDS = [
  {
    field: 'startDate',
    id: 'start-date',
    label: 'Start date',
    description: null,
  },
  {
    field: 'endDate',
    id: 'end-date',
    label: 'End date',
    description: 'On or after the start date.',
  },
  {
    field: 'registrationDeadline',
    id: 'registration-deadline',
    label: 'Registration deadline',
    description:
      'Teams and free agents can register until the end of this day. It must be before the start date.',
  },
] as const;

const FOCUS_SELECTOR: Record<SeasonField, string> = {
  name: '#name',
  slug: '#slug',
  startDate: '#start-date',
  endDate: '#end-date',
  registrationDeadline: '#registration-deadline',
};

@Component({
  selector: 'app-season-create-form',
  imports: [
    MousePressKeepsFocus,
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    NgIcon,
    StickyFooter,
    StickyFooterFocus,
  ],
  providers: [
    provideIcons({ lucideCheck, lucideCircleAlert, lucideGlobe, lucideLoaderCircle, lucidePlus }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      appStickyFooterFocus
      novalidate
      aria-labelledby="create-season-heading"
      aria-describedby="create-season-note"
      class="px-4 py-4 md:px-5 md:py-5"
      (submit)="submit($event)"
      (input)="edited()"
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
      <p id="create-season-note" class="mb-5 text-sm text-muted-foreground">
        A season is one run of {{ leagueName() }}, with its own dates, registration, teams, and
        schedule. It starts as a draft, which only your staff see.
      </p>
      <div data-slot="field-group" [class]="fieldGroupClass + ' ' + clearanceClass">
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          [attr.data-invalid]="form.errors.name() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="name" data-slot="field-label" [class]="labelClass">Name</label>
          <input
            id="name"
            type="text"
            data-slot="input"
            autocomplete="off"
            [formField]="form.fields.name"
            (blur)="form.left('name')"
            (input)="nameTyped($event)"
            [attr.aria-describedby]="describedBy('name', 'name-description')"
            [attr.aria-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="name-description" [class]="descriptionClass">
            Up to 100 characters, for example Fall 2027. Players see it with the league’s name.
          </p>
          @if (form.errors.name(); as error) {
            <div role="alert" data-slot="field-error" id="name-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
          [attr.data-invalid]="form.errors.slug() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="slug" data-slot="field-label" [class]="labelClass">Slug</label>
          <input
            id="slug"
            type="text"
            data-slot="input"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="none"
            [formField]="form.fields.slug"
            (blur)="form.left('slug')"
            (input)="form.slugEdited.set(true)"
            [attr.aria-describedby]="describedBy('slug', 'slug-description')"
            [attr.aria-invalid]="form.errors.slug() ? 'true' : null"
            [attr.data-invalid]="form.errors.slug() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="slug-description" [class]="descriptionClass">
            3 to 60 lowercase letters and digits, with single hyphens between them. Unique within
            {{ leagueName() }}.
          </p>
          @if (form.errors.slug(); as error) {
            <div role="alert" data-slot="field-error" id="slug-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              @if (form.takenSlug(); as taken) {
                <span
                  ><strong class="font-semibold">{{ taken }}</strong
                  >{{ error.slice(taken.length) }}</span
                >
              } @else if (form.reservedParts(); as parts) {
                <span
                  >{{ parts.before }}<strong class="font-semibold">new</strong
                  >{{ parts.after }}</span
                >
              } @else {
                <span>{{ error }}</span>
              }
            </div>
          }
        </div>
        <div class="grid gap-6 sm:max-lg:grid-cols-2">
          @for (date of dateFields; track date.field) {
            <div
              role="group"
              data-slot="field"
              data-orientation="vertical"
              [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
              [class]="
                date.field === 'registrationDeadline'
                  ? fieldClass + ' sm:max-lg:col-span-2'
                  : fieldClass
              "
            >
              <label [for]="date.id" data-slot="field-label" [class]="labelClass">{{
                date.label
              }}</label>
              <input
                [id]="date.id"
                type="date"
                data-slot="input"
                autocomplete="off"
                [formField]="form.fields[date.field]"
                (blur)="form.left(date.field)"
                [attr.aria-describedby]="
                  describedBy(
                    date.field,
                    date.description ? date.id + '-description' : null,
                    date.id
                  )
                "
                [attr.aria-invalid]="form.errors[date.field]() ? 'true' : null"
                [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
                [class]="inputClass"
              />
              @if (date.description) {
                <p
                  data-slot="field-description"
                  [id]="date.id + '-description'"
                  [class]="descriptionClass"
                >
                  {{ date.description }}
                </p>
              }
              @if (form.errors[date.field](); as error) {
                <div
                  role="alert"
                  data-slot="field-error"
                  [id]="date.id + '-error'"
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
          }
        </div>
        <section aria-labelledby="from-league-heading" class="rounded-lg bg-muted p-4">
          <h3 id="from-league-heading" class="text-sm font-medium">From the league</h3>
          <dl class="mt-3 grid gap-3 text-sm sm:max-lg:grid-cols-2">
            <div>
              <dt class="text-muted-foreground">Division</dt>
              <dd class="mt-0.5 font-medium" data-slot="season-division">
                {{ fromLeague().division }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Minimum roster size</dt>
              <dd class="mt-0.5 font-medium" data-slot="season-minimum">
                {{ fromLeague().minimum }}
              </dd>
            </div>
          </dl>
          <p class="mt-3 text-sm text-muted-foreground">
            To change them,
            <a
              [href]="detailsHref()"
              class="inline-block font-medium text-foreground underline underline-offset-4 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
              (click)="detailsOpened.emit($event)"
              >edit the league details</a
            >. Seasons already published keep theirs.
          </p>
        </section>
      </div>
      @if (divisionMissing()) {
        <app-admin-alert
          #leagueAlert
          kind="error"
          [title]="leagueFormatMissingMessage"
          class="mt-5"
        />
      }
      <div appStickyFooter>
        <div role="status" data-slot="created-status">
          @if (created(); as season) {
            <div [class]="createdClass">
              <ng-icon name="lucideCheck" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
              <div class="flex min-w-0 flex-wrap items-center gap-x-3">
                <span
                  data-slot="created-title"
                  [class]="createdTitleClass"
                  style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere"
                  >{{ season.name }} created as a draft.</span
                >
                @if (publishable()) {
                  <button
                    type="button"
                    data-slot="button"
                    data-created-action
                    aria-haspopup="dialog"
                    [class]="publishClass"
                    (click)="publishRequested.emit(season)"
                  >
                    <ng-icon
                      name="lucideGlobe"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Publish season<span class="sr-only"> {{ season.name }}</span>
                  </button>
                } @else {
                  <a
                    data-created-action
                    [href]="seasonHref(season.slug)"
                    class="inline-flex items-center font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                    (click)="seasonShown.emit({ event: $event, slug: season.slug })"
                    >Show it in Seasons</a
                  >
                }
              </div>
            </div>
          }
        </div>
        <button
          #submitButton
          type="submit"
          appMousePressKeepsFocus
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
            />Creating season…
          } @else {
            <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create draft
            season
          }
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Creating the season.' : '' }}</p>
    </form>
  `,
})
export class SeasonCreateForm {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly create = injectMutation(api.seasons.create);

  readonly leagueId = input.required<Id<'leagues'>>();
  readonly leagueName = input.required<string>();
  readonly division = input<OrganizerLeague['division']>();
  readonly detailsHref = input.required<string>();
  readonly detailsOpened = output<MouseEvent>();
  readonly leaguePublished = input.required<boolean>();
  readonly leagueHref = input.required<string>();
  readonly publishedSeasonIds = input<ReadonlySet<string>>(new Set());
  readonly publishRequested = output<CreatedSeason>();
  readonly seasonShown = output<SeasonShown>();

  protected readonly online = injectOnline();
  protected readonly form = new SeasonForm();
  protected readonly alerts = SEASON_FORM_ALERTS;
  protected readonly dateFields = DATE_FIELDS;
  protected readonly leagueFormatMissingMessage = SEASON_MESSAGES.leagueFormatMissing;

  protected readonly fromLeague = computed(() => {
    const division = this.division();
    if (!division) return { division: NOT_SET, minimum: NOT_SET };
    const { playersPerSide, minimumRosterSize } = division;
    const raised = minimumRosterSize !== undefined && minimumRosterSize > playersPerSide;
    return {
      division: division.label,
      minimum: raised
        ? `${minimumRosterSize} players, raised for this league`
        : `${playersPerSide} players, set by the ${formatLabel(playersPerSide)} format`,
    };
  });

  protected readonly divisionMissing = computed(() => !this.division());

  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full sm:w-auto`;
  protected readonly createdClass = CREATED_STATUS;
  protected readonly createdTitleClass = CREATED_TITLE;
  protected readonly publishClass = OUTLINE_BUTTON;

  protected readonly created = signal<CreatedSeason | null>(null);

  protected readonly publishable = computed(() => {
    const season = this.created();
    return (
      season !== null && this.leaguePublished() && !this.publishedSeasonIds().has(season.seasonId)
    );
  });

  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly leagueAlert = viewChild<AdminAlert>('leagueAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected describedBy(
    field: SeasonField,
    description: string | null,
    errorId: string = field,
  ): string | null {
    const ids = [description, this.form.errors[field]() ? `${errorId}-error` : null];
    const described = ids.filter((id): id is string => id !== null).join(' ');
    return described === '' ? null : described;
  }

  protected seasonHref(slug: string): string {
    return `${this.leagueHref()}#season-${slug}`;
  }

  clearCreated(): void {
    this.created.set(null);
  }

  focusNextStep(): void {
    const action = this.host.nativeElement.querySelector<HTMLElement>('[data-created-action]');
    (action ?? this.submitButton().nativeElement).focus();
  }

  protected edited(): void {
    this.created.set(null);
  }

  protected nameTyped(event: Event): void {
    // Read from the event, so the order of this handler and the form field's does not matter.
    this.form.nameTyped((event.target as HTMLInputElement).value);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    this.created.set(null);
    const leagueId = this.leagueId();
    let seasonId: Id<'seasons'> | undefined;
    const outcome = await this.form.submit(this.online(), async (values) => {
      ({ seasonId } = await this.create.run({ leagueId, ...values }));
    });
    if (outcome.sent && seasonId !== undefined) {
      const { name, slug, registrationDeadline } = outcome.values;
      this.created.set({ seasonId, name, slug, registrationDeadline });
      this.form.clear();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else if ('leagueFormatMissing' in outcome) {
      this.focusAfterRender(() => this.leagueAlert()?.focus());
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusField(field: SeasonField): void {
    this.host.nativeElement.querySelector<HTMLElement>(FOCUS_SELECTOR[field])?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
