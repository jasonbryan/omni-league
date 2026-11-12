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
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmRadioGroupImports } from '../../ui/radio-group';
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
  imports: [ConfirmDialog, HlmFieldImports, HlmFieldSetImports, HlmRadioGroupImports, NgIcon],
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
        hlmFieldSet
        ngProjectAs="[confirm-body]"
        id="place-team"
        [attr.aria-describedby]="unchosen() ? 'place-team-error' : null"
      >
        <legend hlmFieldLegend id="place-team-legend" variant="label">Team</legend>
        <hlm-radio-group
          [name]="teamInputName"
          aria-labelledby="place-team-legend"
          [invalid]="unchosen()"
          [value]="chosen()"
          (valueChange)="choose($event)"
        >
          @for (team of options(); track team.teamId) {
            <div hlmField orientation="horizontal" [attr.data-disabled]="team.full ? 'true' : null">
              <hlm-radio
                [inputId]="'place-team-' + team.teamId"
                [value]="team.teamId"
                [disabled]="team.full"
                [aria-describedby]="'place-team-' + team.teamId + '-description'"
              >
                <hlm-radio-indicator />
              </hlm-radio>
              <div hlmFieldContent>
                <label hlmFieldLabel [for]="'place-team-' + team.teamId">{{ team.name }}</label>
                <p hlmFieldDescription [id]="'place-team-' + team.teamId + '-description'">
                  {{ team.roster }}
                </p>
              </div>
            </div>
          }
        </hlm-radio-group>
        @if (unchosen()) {
          <div hlmFieldError id="place-team-error">
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

  protected choose(teamId: Id<'teams'> | null): void {
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
