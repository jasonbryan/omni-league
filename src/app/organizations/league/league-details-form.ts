import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideCircleAlert,
  lucideLoaderCircle,
  lucideSparkles,
  lucideUndo2,
} from '@ng-icons/lucide';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../../convex/_generated/api';
import { filledFromNameMessage } from '../admin/league-division';
import { inputErrorOf } from '../admin/league-form';
import { ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from '../admin/admin-alert';
import { PRIMARY_BUTTON } from '../admin/button-classes';
import { DESCRIPTION, FIELD, FIELD_ERROR, INPUT, LABEL } from '../admin/field-classes';
import { FieldNoteText } from '../admin/field-note';
import {
  LeagueDivisionFields,
  type DivisionField,
  type OwnCustomLevel,
} from '../admin/league-division-fields';
import { STICKY_FOOTER, STICKY_FOOTER_CLEARANCE } from '../admin/sticky-footer';
import type { OrganizerLeague } from './league-context';
import {
  DETAILS_ALERTS,
  LeagueDetails,
  savedDetails,
  type DetailsField,
  type SavedDetails,
} from './league-details-state';
import { formatHint, publishedSeasonsEarliestFirst } from './league-format-hint';

type Earlier = FunctionReturnType<typeof api.leagues.update>;

type Status = { kind: 'saved'; earlier: Earlier } | { kind: 'restored' };

const UNDO_OFFLINE = "You're offline. Nothing was undone. Try again when you're connected.";
const UNDO_FAILED = 'The earlier details could not be restored. Try again.';

function savedFromEarlier({ league }: Earlier): SavedDetails {
  const { gender, playersPerSide, level, ageGroup } = league;
  const complete =
    gender !== undefined &&
    playersPerSide !== undefined &&
    level !== undefined &&
    ageGroup !== undefined;
  return {
    name: league.name,
    division: complete
      ? {
          gender,
          playersPerSide,
          level,
          customLevelId: league.customLevelId,
          ageGroup,
          minimumRosterSize: league.minimumRosterSize,
        }
      : undefined,
  };
}

@Component({
  selector: 'app-league-details-form',
  imports: [AdminAlert, FieldNoteText, FormField, LeagueDivisionFields, NgIcon],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleAlert,
      lucideLoaderCircle,
      lucideSparkles,
      lucideUndo2,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      aria-labelledby="details-heading"
      class="px-4 py-5 md:px-6 md:py-6"
      (submit)="submit($event)"
    >
      @if (details.alert(); as kind) {
        <app-admin-alert
          #failureAlert
          [kind]="kind === 'offline' ? 'offline' : 'error'"
          [title]="alerts[kind].title"
          [description]="alerts[kind].description"
          class="mb-5"
        />
      }
      <div data-slot="field-group" [class]="clearanceClass + ' flex flex-col gap-6'">
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="details.errors.name() ? 'true' : null"
          [attr.data-invalid]="details.errors.name() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="league-name" data-slot="field-label" [class]="labelClass">Name</label>
          <input
            #name
            id="league-name"
            type="text"
            data-slot="input"
            autocomplete="off"
            [formField]="details.fields.name"
            (blur)="details.left('name')"
            [attr.aria-describedby]="nameDescribedBy()"
            [attr.aria-invalid]="details.errors.name() ? 'true' : null"
            [attr.data-invalid]="details.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="details.errors.name() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="league-name-description" [class]="descriptionClass">
            The name players know it by every season, such as Sunday Coed 4s. Up to 100 characters.
          </p>
          @if (details.notes.name(); as note) {
            <app-field-note id="league-name-note" [note]="note" />
          }
          @if (details.errors.name(); as error) {
            <div role="alert" data-slot="field-error" id="league-name-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
        <fieldset data-slot="field-set" class="border-t border-border pt-5">
          <legend class="float-start w-full text-base font-semibold">Division</legend>
          <p class="clear-both pt-1 text-sm text-muted-foreground">
            Players filter leagues by these on your public page and in Find a league.
          </p>
          <div role="status">
            @if (filledMessage(); as message) {
              <p
                class="mt-3 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground"
              >
                <ng-icon
                  name="lucideSparkles"
                  class="mt-0.5 shrink-0 text-base"
                  aria-hidden="true"
                />
                <span>{{ message }}</span>
              </p>
            }
          </div>
          <app-league-division-fields
            class="mt-5"
            idPrefix="details-"
            [division]="details.division"
            [sport]="league().sport"
            [organizationId]="league().organizationId"
            [errors]="details.errors"
            [formatDescription]="formatDescription()"
            [canAddCustomLevel]="league().role === 'orgAdmin'"
            [ownCustomLevel]="ownCustomLevel()"
            (minimumLeft)="details.left('minimumRosterSize')"
          />
        </fieldset>
      </div>
      <div role="status" data-slot="save-status">
        @if (shownStatus(); as status) {
          <div
            #statusBox
            tabindex="-1"
            class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground"
          >
            <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />
            @if (status.kind === 'saved') {
              <span class="font-medium">League details saved.</span>
              @if (undoOffered()) {
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                  [class.opacity-50]="!online() && !undoing()"
                  [attr.aria-disabled]="undoing() || !online() ? 'true' : null"
                  (click)="undo(status.earlier)"
                >
                  <ng-icon name="lucideUndo2" class="text-base" aria-hidden="true" />{{
                    undoing() ? 'Undoing…' : 'Undo'
                  }}
                </button>
              }
              @if (undoNote(); as note) {
                <span class="basis-full">{{ note }}</span>
              }
            } @else {
              <span class="font-medium">Earlier details restored.</span>
            }
          </div>
        }
      </div>
      <div data-slot="form-footer" [class]="footerClass">
        <button
          #submitButton
          type="submit"
          data-slot="button"
          [class]="buttonClass"
          [class.opacity-50]="!online() && !details.submitting()"
          [attr.aria-disabled]="details.submitting() || !online() ? 'true' : null"
        >
          @if (details.submitting()) {
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
      </div>
      <p role="status" class="sr-only">
        {{ details.submitting() ? 'Saving the league details.' : '' }}
      </p>
      <div role="status" class="sr-only" data-slot="note-announcement">
        @for (text of details.announcement(); track text) {
          <p>{{ text }}</p>
        }
      </div>
    </form>
  `,
})
export class LeagueDetailsForm implements OnInit {
  private readonly injector = inject(Injector);
  private readonly updateCall = injectMutation(api.leagues.update);
  private readonly undoCall = injectMutation(api.leagues.undoUpdate);

  readonly league = input.required<OrganizerLeague>();
  readonly seasons = input<
    readonly { name: string; startDate: string; formatName: string; status: string }[]
  >([]);

  protected readonly online = injectOnline();
  protected readonly details = new LeagueDetails(() => this.league().sport);
  protected readonly alerts = DETAILS_ALERTS;

  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full sm:w-auto`;
  protected readonly footerClass = STICKY_FOOTER;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;

  protected readonly status = signal<Status | null>(null);
  protected readonly undoing = signal(false);
  protected readonly undoNote = signal<string | null>(null);

  // Kept once seen, so Undo can choose the level again after a save replaced it with a standard one.
  protected readonly ownCustomLevel = linkedSignal<
    OrganizerLeague['division'],
    OwnCustomLevel | null
  >({
    source: () => this.league().division,
    computation: (division, previous) =>
      division?.customLevel
        ? { ...division.customLevel, standardLevel: division.level }
        : (previous?.value ?? null),
  });

  protected readonly shownStatus = computed(() =>
    this.details.editedSinceLoad() ? null : this.status(),
  );
  // Someone else's save leaves the league holding neither set of values, and Undo would revert it.
  protected readonly undoOffered = computed(() => {
    const status = this.status();
    if (status?.kind !== 'saved') return false;
    const { league, written } = status.earlier;
    const hasDivision = league.gender !== undefined;
    return hasDivision && (this.leagueHolds(written) || this.leagueHolds(league));
  });

  protected readonly nameDescribedBy = computed(() =>
    [
      'league-name-description',
      this.details.notes.name() ? 'league-name-note' : null,
      this.details.errors.name() ? 'league-name-error' : null,
    ]
      .filter((id) => id !== null)
      .join(' '),
  );
  protected readonly formatDescription = computed(() =>
    formatHint(publishedSeasonsEarliestFirst(this.seasons())),
  );
  protected readonly filledMessage = computed(() =>
    filledFromNameMessage(this.details.division.filledFromName()),
  );

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly divisionFields = viewChild.required(LeagueDivisionFields);
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
  private readonly statusBox = viewChild<ElementRef<HTMLElement>>('statusBox');

  private loadedLeagueId = '';

  constructor() {
    effect(() => {
      const league = this.league();
      untracked(() => this.follow(league));
    });
  }

  private leagueHolds(values: {
    name: string;
    gender?: string | undefined;
    playersPerSide?: number | undefined;
    level?: string | undefined;
    customLevelId?: string | undefined;
    ageGroup?: string | undefined;
    minimumRosterSize?: number | undefined;
  }): boolean {
    const { name, division } = this.league();
    return (
      values.name === name &&
      values.gender === division?.gender &&
      values.playersPerSide === division?.playersPerSide &&
      values.level === division?.level &&
      values.customLevelId === division?.customLevel?.customLevelId &&
      values.ageGroup === division?.ageGroup &&
      values.minimumRosterSize === division?.minimumRosterSize
    );
  }

  ngOnInit(): void {
    this.loadLeague(this.league());
  }

  private loadLeague({ leagueId, name, division }: OrganizerLeague): void {
    this.loadedLeagueId = leagueId;
    this.details.load(savedDetails(name, division));
  }

  private follow(league: OrganizerLeague): void {
    if (league.leagueId !== this.loadedLeagueId) {
      this.loadLeague(league);
      this.status.set(null);
      return;
    }
    this.details.takeNewerLeague(savedDetails(league.name, league.division));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.details.submitting() || this.undoing()) return;
    this.status.set(null);
    this.undoNote.set(null);
    const leagueId = this.league().leagueId;
    const outcome = await this.details.submit(this.online(), (values, expected) =>
      this.updateCall.run({ leagueId, ...values, expected }),
    );
    if (outcome.sent) {
      this.details.load({ name: outcome.values.name, division: outcome.values });
      this.status.set({ kind: 'saved', earlier: outcome.result });
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      const { customLevel, level } = outcome.current?.division ?? {};
      // The newer level may be a custom level this form has not shown yet.
      if (customLevel && level) this.ownCustomLevel.set({ ...customLevel, standardLevel: level });
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  protected async undo(earlier: Earlier): Promise<void> {
    if (this.undoing()) return;
    this.undoNote.set(null);
    if (!this.online()) {
      this.undoNote.set(UNDO_OFFLINE);
      return;
    }
    this.undoing.set(true);
    try {
      await this.undoCall.run({ leagueId: this.league().leagueId, ...earlier });
      this.details.load(savedFromEarlier(earlier));
      this.divisionFields().collapseMinimum();
      this.status.set({ kind: 'restored' });
      // The Undo button that had focus is gone.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.undoNote.set(
        failure instanceof ConvexOfflineError
          ? UNDO_OFFLINE
          : (inputErrorOf(failure)?.message ?? UNDO_FAILED),
      );
    } finally {
      this.undoing.set(false);
    }
  }

  private focusField(field: DetailsField): void {
    if (field === 'name') this.nameInput().nativeElement.focus();
    else this.divisionFields().focus(field satisfies DivisionField);
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
