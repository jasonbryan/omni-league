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
import { lucideCheck, lucideCircleAlert, lucideGlobe, lucidePlus } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { formatLabel } from '../../../../convex/lib/divisions';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { injectSlugAvailability } from '../../core/forms/slug-availability';
import { publicLeaguePath } from '../public-league/public-league-path';
import { WebAddressPreview } from '../admin/web-address-preview';
import { WebAddressStatus } from '../admin/web-address-status';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../admin/button-classes';
import { CREATED_STATUS, CREATED_TITLE } from '../admin/footer-status';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from '../admin/sticky-footer';
import { StickyFooterFocus } from '../admin/sticky-footer-focus';
import type { OrganizerLeague } from './league-context';
import { SEASON_FORM_ALERTS, SeasonForm, type SeasonField } from './season-form';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';

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
  maxTeams: '#maximum-teams',
  maxRosterSize: '#maximum-roster-size',
};

@Component({
  selector: 'app-season-create-form',
  imports: [
    HlmSpinner,
    MousePressKeepsFocus,
    AdminAlert,
    AdminOfflineAlert,
    FormField,
    HlmFieldImports,
    HlmFieldSetImports,
    HlmInputImports,
    NgIcon,
    StickyFooter,
    StickyFooterFocus,
    WebAddressPreview,
    WebAddressStatus,
  ],
  providers: [provideIcons({ lucideCheck, lucideCircleAlert, lucideGlobe, lucidePlus })],
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
      <div hlmFieldGroup [class]="clearanceClass">
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          [attr.data-invalid]="form.errors.name() ? 'true' : null"
        >
          <label hlmFieldLabel for="name">Name</label>
          <input
            hlmInput
            id="name"
            type="text"
            autocomplete="off"
            [formField]="form.fields.name"
            (blur)="form.left('name')"
            (input)="nameTyped($event)"
            [attr.aria-describedby]="describedBy('name', 'name-description')"
            [attr.aria-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          />
          <p hlmFieldDescription id="name-description">
            Up to 100 characters, for example Fall 2027. Players see it with the league’s name.
          </p>
          @if (form.errors.name(); as error) {
            <div hlmFieldError id="name-error">
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
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
          [attr.data-invalid]="form.errors.slug() ? 'true' : null"
        >
          <label hlmFieldLabel for="slug">Web address</label>
          <input
            hlmInput
            id="slug"
            type="text"
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
          />
          <p hlmFieldDescription id="slug-description">
            3 to 60 lowercase letters and digits, with single hyphens between them. Unique within
            {{ leagueName() }}. Its public page will be at
            <app-web-address-preview [parent]="addressParent()" [slug]="addressSlug()" />
          </p>
          <app-web-address-status
            [available]="form.slugAvailable()"
            [reserveRoom]="form.slugStatusReservesRoom()"
          />
          @if (form.errors.slug(); as error) {
            <div hlmFieldError id="slug-error">
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
              hlmField
              [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
              [class]="date.field === 'registrationDeadline' ? 'sm:max-lg:col-span-2' : ''"
            >
              <label hlmFieldLabel [for]="date.id">{{ date.label }}</label>
              <input
                hlmInput
                [id]="date.id"
                type="date"
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
              />
              @if (date.description) {
                <p hlmFieldDescription [id]="date.id + '-description'">
                  {{ date.description }}
                </p>
              }
              @if (form.errors[date.field](); as error) {
                <div hlmFieldError [id]="date.id + '-error'">
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
        <fieldset hlmFieldSet id="limits" aria-describedby="limits-description">
          <legend hlmFieldLegend variant="label">Limits</legend>
          <p hlmFieldDescription id="limits-description">Optional. Leave a limit blank for none.</p>
          <div
            hlmField
            [attr.data-matches-spartan-invalid]="form.errors.maxTeams() ? 'true' : null"
            [attr.data-invalid]="form.errors.maxTeams() ? 'true' : null"
          >
            <label hlmFieldLabel for="maximum-teams">Maximum teams</label>
            <input
              hlmInput
              id="maximum-teams"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [formField]="form.fields.maxTeams"
              (blur)="form.left('maxTeams')"
              [attr.aria-describedby]="
                describedBy('maxTeams', 'maximum-teams-description', 'maximum-teams')
              "
              [attr.aria-invalid]="form.errors.maxTeams() ? 'true' : null"
              [attr.data-invalid]="form.errors.maxTeams() ? 'true' : null"
              [attr.data-matches-spartan-invalid]="form.errors.maxTeams() ? 'true' : null"
            />
            <p hlmFieldDescription id="maximum-teams-description">
              2 to 200. When it’s reached, the season is full.
            </p>
            @if (form.errors.maxTeams(); as error) {
              <div hlmFieldError id="maximum-teams-error">
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
            hlmField
            [attr.data-matches-spartan-invalid]="form.errors.maxRosterSize() ? 'true' : null"
            [attr.data-invalid]="form.errors.maxRosterSize() ? 'true' : null"
          >
            <label hlmFieldLabel for="maximum-roster-size">Maximum roster size</label>
            <input
              hlmInput
              id="maximum-roster-size"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [formField]="form.fields.maxRosterSize"
              (blur)="form.left('maxRosterSize')"
              [attr.aria-describedby]="
                describedBy(
                  'maxRosterSize',
                  'maximum-roster-size-description',
                  'maximum-roster-size'
                )
              "
              [attr.aria-invalid]="form.errors.maxRosterSize() ? 'true' : null"
              [attr.data-invalid]="form.errors.maxRosterSize() ? 'true' : null"
              [attr.data-matches-spartan-invalid]="form.errors.maxRosterSize() ? 'true' : null"
            />
            <p hlmFieldDescription id="maximum-roster-size-description">
              From the minimum roster size to 99. A full team takes no more players.
            </p>
            @if (form.errors.maxRosterSize(); as error) {
              <div hlmFieldError id="maximum-roster-size-error">
                <ng-icon
                  name="lucideCircleAlert"
                  class="mt-0.5 shrink-0 text-base"
                  aria-hidden="true"
                />
                <span>{{ error }}</span>
              </div>
            }
          </div>
        </fieldset>
      </div>
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
            <hlm-spinner data-icon="inline-start" />Creating season…
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
  readonly organizationSlug = input.required<string>();
  readonly leagueSlug = input.required<string>();
  readonly division = input.required<OrganizerLeague['division']>();
  readonly detailsHref = input.required<string>();
  readonly detailsOpened = output<MouseEvent>();
  readonly leaguePublished = input.required<boolean>();
  readonly leagueHref = input.required<string>();
  readonly publishedSeasonIds = input<ReadonlySet<string>>(new Set());
  readonly publishRequested = output<CreatedSeason>();
  readonly seasonShown = output<SeasonShown>();

  protected readonly online = injectOnline();
  private readonly minimumRosterSize = computed(() => {
    const { minimumRosterSize, playersPerSide } = this.division();
    return minimumRosterSize ?? playersPerSide;
  });
  private readonly webAddress = injectSlugAvailability({
    query: api.seasons.isSlugAvailable,
    slug: (): string => this.form.model().slug,
    scope: () => ({ leagueId: this.leagueId() }),
  });
  protected readonly form = new SeasonForm(() => this.minimumRosterSize(), this.webAddress);
  protected readonly addressParent = computed(
    () => `${publicLeaguePath(this.organizationSlug(), this.leagueSlug())}/seasons`,
  );
  protected readonly addressSlug = computed(() => this.form.model().slug || 'your-address');
  protected readonly alerts = SEASON_FORM_ALERTS;
  protected readonly dateFields = DATE_FIELDS;

  protected readonly fromLeague = computed(() => {
    const { label, playersPerSide, minimumRosterSize } = this.division();
    const raised = minimumRosterSize !== undefined && minimumRosterSize > playersPerSide;
    return {
      division: label,
      minimum: raised
        ? `${minimumRosterSize} players, raised for this league`
        : `${playersPerSide} players, set by the ${formatLabel(playersPerSide)} format`,
    };
  });

  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
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
