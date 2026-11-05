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
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideUserPlus } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { teamIsFull } from '../../../../convex/lib/seasonInput';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { ConfirmDialog } from '../admin/confirm-dialog';
import {
  DESCRIPTION,
  FIELD_CONTENT,
  FIELD_ERROR,
  FIELD_HORIZONTAL,
  FIELD_SET,
  LABEL,
  LEGEND,
  RADIO_EDGE,
  RADIO_EDGE_INVALID,
  RADIO_INDICATOR,
  RADIO_INPUT,
  RADIO_ITEM,
} from '../admin/field-classes';
import { placeFailureText, type PlaceFailure, placeFailureOf } from './place-free-agent-text';
import { teamRowLines } from './team-row-lines';

export interface PlaceFreeAgentTarget {
  freeAgentId: Id<'freeAgents'>;
  name: string;
}

export interface PlaceTeamOption {
  teamId: Id<'teams'>;
  name: string;
  rosterCount: number;
}

export interface PlaceFreeAgentOutcome {
  freeAgentId: Id<'freeAgents'>;
  name: string;
  /** `null` when the dialog was cancelled. */
  placedOn: { teamName: string; rosterCount: number } | null;
}

const TEAM_INPUT_NAME = 'place-team';

@Component({
  selector: 'app-place-free-agent-dialog',
  imports: [ConfirmDialog, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideUserPlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      [role]="'dialog'"
      withBody
      icon="lucideUserPlus"
      confirmLabel="Place on team"
      pendingLabel="Placing…"
      [heading]="heading()"
      [autoFocus]="firstTeamSelector"
      [pending]="placing()"
      [alert]="alert()"
      (confirmed)="place()"
      (closed)="onClosed()"
    >
      <p>
        They join the team’s roster and can open its page. A person can be on one team in a season.
      </p>
      <fieldset
        ngProjectAs="[confirm-body]"
        id="place-team"
        data-slot="field-set"
        [class]="fieldSetClass"
        [attr.aria-describedby]="unchosen() ? 'place-team-error' : null"
      >
        <legend data-slot="field-legend" data-variant="label" [class]="legendClass">Team</legend>
        <div data-slot="radio-group" class="grid gap-3">
          @for (team of options(); track team.teamId) {
            <div
              role="group"
              data-slot="field"
              data-orientation="horizontal"
              [attr.data-disabled]="team.full ? 'true' : null"
              [class]="fieldHorizontalClass"
            >
              <span
                data-slot="radio-group-item"
                [attr.data-checked]="chosen() === team.teamId ? 'true' : null"
                [class]="
                  radioItemClass +
                  ' ' +
                  (unchosen() ? radioEdgeInvalid : radioEdge) +
                  (team.full ? ' opacity-50' : '')
                "
                ><input
                  type="radio"
                  [id]="'place-team-' + team.teamId"
                  [name]="teamInputName"
                  [value]="team.teamId"
                  [disabled]="team.full"
                  [checked]="chosen() === team.teamId"
                  [attr.aria-describedby]="'place-team-' + team.teamId + '-description'"
                  (change)="choose(team.teamId)"
                  [class]="radioInputClass" /><span
                  aria-hidden="true"
                  [class]="radioIndicatorClass"
                ></span
              ></span>
              <div data-slot="field-content" [class]="fieldContentClass">
                <label
                  [for]="'place-team-' + team.teamId"
                  data-slot="field-label"
                  [class]="labelClass"
                  >{{ team.name }}</label
                >
                <p
                  data-slot="field-description"
                  [id]="'place-team-' + team.teamId + '-description'"
                  [class]="fieldDescriptionClass"
                >
                  {{ team.roster }}
                </p>
              </div>
            </div>
          }
        </div>
        @if (unchosen()) {
          <div role="alert" data-slot="field-error" id="place-team-error" [class]="errorClass">
            <ng-icon
              name="lucideCircleAlert"
              class="mt-0.5 shrink-0 text-base"
              aria-hidden="true"
            />
            <span>Choose a team.</span>
          </div>
        }
      </fieldset>
    </app-confirm-dialog>
  `,
})
export class PlaceFreeAgentDialog {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly placeFreeAgent = injectMutation(api.freeAgents.place);

  readonly teams = input.required<readonly PlaceTeamOption[]>();
  readonly minimumRosterSize = input.required<number>();
  readonly maxRosterSize = input<number | undefined>(undefined);
  readonly dismissed = output<PlaceFreeAgentOutcome>();

  protected readonly online = injectOnline();
  protected readonly firstTeamSelector = `input[name="${TEAM_INPUT_NAME}"]:not(:disabled)`;
  protected readonly teamInputName = TEAM_INPUT_NAME;
  protected readonly fieldSetClass = FIELD_SET;
  protected readonly legendClass = LEGEND;
  protected readonly fieldHorizontalClass = FIELD_HORIZONTAL;
  protected readonly fieldContentClass = FIELD_CONTENT;
  protected readonly labelClass = LABEL;
  protected readonly fieldDescriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly radioItemClass = RADIO_ITEM;
  protected readonly radioEdge = RADIO_EDGE;
  protected readonly radioEdgeInvalid = RADIO_EDGE_INVALID;
  protected readonly radioInputClass = RADIO_INPUT;
  protected readonly radioIndicatorClass = RADIO_INDICATOR;

  protected readonly target = signal<PlaceFreeAgentTarget | null>(null);
  protected readonly chosen = signal<Id<'teams'> | null>(null);
  protected readonly unchosen = signal(false);
  protected readonly placing = signal(false);
  private readonly failure = signal<PlaceFailure | null>(null);

  protected readonly options = computed(() => {
    const max = this.maxRosterSize();
    return this.teams().map((team) => {
      const full = teamIsFull(team.rosterCount, max);
      return {
        ...team,
        full,
        roster: full
          ? `Full: ${team.rosterCount} of ${max} players`
          : teamRowLines(team.rosterCount, this.minimumRosterSize(), 0).roster,
      };
    });
  });
  protected readonly alert = computed(() => {
    const failure = this.failure();
    const target = this.target();
    return failure && target ? placeFailureText(failure, target.name) : null;
  });
  protected readonly heading = computed(() => `Place ${this.target()?.name} on a team`);

  private readonly dialog = viewChild.required(ConfirmDialog);
  private placedOn: PlaceFreeAgentOutcome['placedOn'] = null;

  readonly isOpen = computed(() => this.dialog().isOpen());

  open(target: PlaceFreeAgentTarget): void {
    const choosable = this.options().filter((team) => !team.full);
    this.target.set(target);
    this.chosen.set(choosable.length === 1 ? choosable[0].teamId : null);
    this.unchosen.set(false);
    this.failure.set(null);
    this.placedOn = null;
    this.dialog().open();
  }

  protected choose(teamId: Id<'teams'>): void {
    this.chosen.set(teamId);
    this.unchosen.set(false);
  }

  protected async place(): Promise<void> {
    const target = this.target();
    if (!target || this.placing()) return;
    this.failure.set(null);
    const team = this.options().find((option) => option.teamId === this.chosen() && !option.full);
    if (!team) {
      this.unchosen.set(true);
      afterNextRender(() => this.firstTeamInput()?.focus(), { injector: this.injector });
      return;
    }
    if (!this.online()) return this.fail({ kind: 'offline' });
    this.placing.set(true);
    try {
      await this.placeFreeAgent.run({ freeAgentId: target.freeAgentId, teamId: team.teamId });
    } catch (error) {
      this.placing.set(false);
      return this.fail(
        error instanceof ConvexOfflineError ? { kind: 'offline' } : placeFailureOf(error),
      );
    }
    this.placing.set(false);
    this.placedOn = { teamName: team.name, rosterCount: team.rosterCount + 1 };
    this.dialog().close();
  }

  protected onClosed(): void {
    const target = this.target();
    if (!target) return;
    this.dismissed.emit({ ...target, placedOn: this.placedOn });
  }

  private firstTeamInput(): HTMLInputElement | null {
    // The dialog's content is in the overlay container, outside this component's element.
    const doc = this.host.nativeElement.ownerDocument;
    return doc.querySelector<HTMLInputElement>(this.firstTeamSelector);
  }

  private fail(failure: PlaceFailure): void {
    this.failure.set(failure);
    this.dialog().focusAlert();
  }
}
