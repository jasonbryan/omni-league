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
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircleAlert, lucideUndo2 } from '@ng-icons/lucide';
import type { FunctionReturnType } from 'convex/server';
import {
  editableOf,
  sameEditable,
  setsPerGameIsChosen,
} from '../../../../convex/lib/tournamentEdit';
import { MAX_MAXIMUM_TEAMS, MIN_MAXIMUM_TEAMS } from '../../../../convex/lib/tournamentInput';
import {
  api,
  ConvexOfflineError,
  injectMutation,
  injectOfflineCause,
  injectOnline,
  offlineTitle,
} from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { HlmFieldImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { FOOTER_STATUS } from './footer-status';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import { DETAILS_ALERTS, TournamentDetails, type DetailsField } from './tournament-details-state';
import type { ManagedTournament } from './tournament-context';
import { inputErrorOf } from './tournament-form';

type Earlier = FunctionReturnType<typeof api.tournaments.updateDetails>;

type Status = { kind: 'saved'; earlier: Earlier } | { kind: 'restored' };

const UNDO_FAILED = 'The earlier details could not be restored. Try again.';

const SETS_OPTIONS: readonly ChipOption[] = [
  { key: '1', label: '1 set' },
  { key: '3', label: '3 sets' },
];

const DATE_FIELDS = [
  { field: 'startDate', id: 'details-start-date', label: 'Start date', description: null },
  {
    field: 'endDate',
    id: 'details-end-date',
    label: 'End date',
    description: 'Leave it blank for a one-day tournament.',
  },
  {
    field: 'registrationDeadline',
    id: 'details-registration-deadline',
    label: 'Registration deadline',
    description:
      'Teams can register until the end of this day. It must be on or before the start date.',
  },
] as const;

const FIELD_IDS: Record<DetailsField, string> = {
  startDate: 'details-start-date',
  endDate: 'details-end-date',
  registrationDeadline: 'details-registration-deadline',
  maximumTeams: 'details-maximum-teams',
};

@Component({
  selector: 'app-tournament-details-form',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    ChipRadioGroup,
    FormField,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinner,
    MousePressKeepsFocus,
    NgIcon,
    StickyFooter,
    StickyFooterFocus,
  ],
  providers: [provideIcons({ lucideCheck, lucideCircleAlert, lucideUndo2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      appStickyFooterFocus
      novalidate
      aria-labelledby="edit-details-heading"
      class="px-4 py-5 md:px-6 md:py-6"
      (submit)="submit($event)"
    >
      @if (details.alert(); as kind) {
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
      <div hlmFieldGroup [class]="clearanceClass">
        <div class="grid gap-6 sm:max-lg:grid-cols-2">
          @for (date of dateFields; track date.field) {
            <div
              hlmField
              [attr.data-matches-spartan-invalid]="details.errors[date.field]() ? 'true' : null"
              [attr.data-invalid]="details.errors[date.field]() ? 'true' : null"
              [class]="date.field === 'registrationDeadline' ? 'sm:max-lg:col-span-2' : ''"
            >
              <label hlmFieldLabel [for]="date.id">{{ date.label }}</label>
              <input
                hlmInput
                [id]="date.id"
                type="date"
                autocomplete="off"
                [formField]="details.fields[date.field]"
                (blur)="details.left(date.field)"
                [attr.aria-describedby]="describedBy(date.field, date.description !== null)"
                [attr.aria-invalid]="details.errors[date.field]() ? 'true' : null"
                [attr.data-invalid]="details.errors[date.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="details.errors[date.field]() ? 'true' : null"
              />
              @if (date.description) {
                <p hlmFieldDescription [id]="date.id + '-description'">
                  {{ date.description }}
                </p>
              }
              @if (details.errors[date.field](); as error) {
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
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="details.errors.maximumTeams() ? 'true' : null"
          [attr.data-invalid]="details.errors.maximumTeams() ? 'true' : null"
        >
          <label hlmFieldLabel for="details-maximum-teams">Maximum teams</label>
          <input
            hlmInput
            id="details-maximum-teams"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [formField]="details.fields.maximumTeams"
            (blur)="details.left('maximumTeams')"
            [attr.aria-describedby]="describedBy('maximumTeams', true)"
            [attr.aria-invalid]="details.errors.maximumTeams() ? 'true' : null"
            [attr.data-invalid]="details.errors.maximumTeams() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="details.errors.maximumTeams() ? 'true' : null"
          />
          <p hlmFieldDescription id="details-maximum-teams-description">
            {{ maximumDescription() }}
          </p>
          @if (details.errors.maximumTeams(); as error) {
            <div hlmFieldError id="details-maximum-teams-error">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
        <div data-slot="structure">
          <span class="text-sm font-medium">Structure</span>
          <p class="mt-1.5 text-sm">Bracket only</p>
        </div>
        @if (hasSetsPerGame() && setsLocked()) {
          <div data-slot="sets-per-game">
            <span class="text-sm font-medium">Sets per game</span>
            <p class="mt-1.5 text-sm">{{ storedSets() }}</p>
            <p hlmFieldDescription class="mt-1.5">
              The bracket is created, so sets per game cannot change.
            </p>
          </div>
        } @else if (hasSetsPerGame()) {
          <app-chip-radio-group
            name="sets-per-game"
            legend="Sets per game"
            [options]="setsOptions"
            [value]="'' + details.setsPerGame()"
            description="Each game is one set, or the best of three."
            (chosen)="chooseSets($event)"
          />
        }
      </div>
      <div appStickyFooter>
        <div role="status" data-slot="save-status">
          @if (shownStatus(); as status) {
            <div #statusBox tabindex="-1" [class]="statusClass">
              <ng-icon name="lucideCheck" class="shrink-0 text-base" aria-hidden="true" />
              @if (status.kind === 'saved') {
                <span class="font-medium">Details saved.</span>
                @if (undoOffered()) {
                  <button
                    type="button"
                    appMousePressKeepsFocus
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
        <button
          type="submit"
          appMousePressKeepsFocus
          data-slot="button"
          [class]="buttonClass"
          [class.opacity-50]="!online() && !details.submitting()"
          [attr.aria-disabled]="details.submitting() || !online() ? 'true' : null"
        >
          @if (details.submitting()) {
            <hlm-spinner data-icon="inline-start" />Saving…
          } @else {
            Save changes
          }
        </button>
      </div>
      <p role="status" class="sr-only">
        {{ details.submitting() ? 'Saving the tournament details.' : '' }}
      </p>
    </form>
  `,
})
export class TournamentDetailsForm implements OnInit {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly updateCall = injectMutation(api.tournaments.updateDetails);
  private readonly undoCall = injectMutation(api.tournaments.undoUpdateDetails);
  private readonly cause = injectOfflineCause();

  readonly tournament = input.required<ManagedTournament>();

  protected readonly online = injectOnline();
  protected readonly details = new TournamentDetails(() => this.tournament().teamCount);
  protected readonly alerts = DETAILS_ALERTS;
  protected readonly dateFields = DATE_FIELDS;
  protected readonly setsOptions = SETS_OPTIONS;

  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full sm:w-auto`;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly statusClass = `${FOOTER_STATUS} flex flex-wrap items-center gap-x-3 gap-y-1`;

  protected readonly status = signal<Status | null>(null);
  protected readonly undoing = signal(false);
  protected readonly undoNote = signal<string | null>(null);

  protected readonly hasSetsPerGame = computed(() => setsPerGameIsChosen(this.tournament().sport));
  protected readonly setsLocked = computed(() => this.tournament().bracketCreated);
  protected readonly storedSets = computed(() =>
    this.tournament().setsPerGame === 3 ? 'Best of 3' : '1 set',
  );
  protected readonly shownStatus = computed(() =>
    this.details.editedSinceLoad() ? null : this.status(),
  );
  // Someone else's save leaves the tournament holding neither set of values, and Undo would revert it.
  protected readonly undoOffered = computed(() => {
    const status = this.status();
    if (status?.kind !== 'saved') return false;
    const held = editableOf(this.tournament());
    return sameEditable(held, status.earlier.written) || sameEditable(held, status.earlier.earlier);
  });
  protected readonly maximumDescription = computed(() => {
    const teams = this.tournament().teamCount;
    const range = `The most teams the bracket takes, from ${MIN_MAXIMUM_TEAMS} to ${MAX_MAXIMUM_TEAMS}.`;
    if (teams === 0) return range;
    return `${range} ${teams} ${teams === 1 ? 'team is' : 'teams are'} registered.`;
  });

  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly statusBox = viewChild<ElementRef<HTMLElement>>('statusBox');

  private loadedTournamentId = '';

  constructor() {
    effect(() => {
      const tournament = this.tournament();
      untracked(() => this.follow(tournament));
    });
  }

  ngOnInit(): void {
    this.loadTournament(this.tournament());
  }

  protected describedBy(field: DetailsField, described: boolean): string | null {
    const id = FIELD_IDS[field];
    const ids = [
      described ? `${id}-description` : null,
      this.details.errors[field]() ? `${id}-error` : null,
    ].filter((part): part is string => part !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  }

  protected chooseSets(key: string): void {
    this.details.setsPerGame.set(key === '3' ? 3 : 1);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.details.submitting() || this.undoing()) return;
    this.status.set(null);
    this.undoNote.set(null);
    const tournamentId = this.tournament().tournamentId;
    const outcome = await this.details.submit(
      this.online(),
      this.hasSetsPerGame() && !this.setsLocked(),
      (values, expected) => this.updateCall.run({ tournamentId, ...values, expected }),
    );
    if (outcome.sent) {
      this.details.load(outcome.result.written);
      this.status.set({ kind: 'saved', earlier: outcome.result });
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  protected async undo(earlier: Earlier): Promise<void> {
    if (this.undoing()) return;
    this.undoNote.set(null);
    if (!this.online()) {
      this.undoNote.set(this.undoOfflineNote());
      return;
    }
    this.undoing.set(true);
    try {
      await this.undoCall.run({ tournamentId: this.tournament().tournamentId, ...earlier });
      this.details.load(earlier.earlier);
      this.status.set({ kind: 'restored' });
      // The Undo button that had focus is gone.
      this.focusAfterRender(() => this.statusBox()?.nativeElement.focus());
    } catch (failure) {
      this.undoNote.set(
        failure instanceof ConvexOfflineError
          ? this.undoOfflineNote()
          : (inputErrorOf(failure)?.message ?? UNDO_FAILED),
      );
    } finally {
      this.undoing.set(false);
    }
  }

  private undoOfflineNote(): string {
    return `${offlineTitle(this.cause(), 'undone')} Try again when you're connected.`;
  }

  private loadTournament(tournament: ManagedTournament): void {
    this.loadedTournamentId = tournament.tournamentId;
    this.details.load(editableOf(tournament));
  }

  private follow(tournament: ManagedTournament): void {
    if (tournament.tournamentId !== this.loadedTournamentId) {
      this.loadTournament(tournament);
      this.status.set(null);
      return;
    }
    this.details.follow(editableOf(tournament));
  }

  private focusField(field: DetailsField): void {
    this.host.nativeElement.querySelector<HTMLElement>(`#${FIELD_IDS[field]}`)?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
