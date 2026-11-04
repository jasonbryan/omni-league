import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChildren,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePencil, lucideUsers, lucideUsersRound } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  checkMaxRosterSizeFor,
  checkMaxTeams,
  type LargestRoster,
} from '../../../../convex/lib/seasonInput';
import { api, injectMutation } from '../../core/data/convex';
import { AdminAlert } from '../admin/admin-alert';
import type { AlertText } from '../admin/alert-text';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { LimitEditForm, type LimitSpec } from './limit-edit-form';
import {
  maxRosterSizeDescription,
  maxRosterSizeSavedText,
  maxRosterSizeSummary,
  maxTeamsDescription,
  maxTeamsSavedText,
  maxTeamsSummary,
} from './limit-text';

const PANEL =
  'mt-6 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';

type Limit = LimitSpec['field'];

interface LimitRow {
  field: Limit;
  icon: string;
  label: string;
  summary: string;
  testId: string;
}

@Component({
  selector: 'app-season-limits',
  imports: [AdminAlert, LimitEditForm, NgIcon],
  providers: [provideIcons({ lucidePencil, lucideUsers, lucideUsersRound })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="limits-heading" [class]="panel">
      <div class="border-b border-border px-4 py-3 md:px-5">
        <h2 id="limits-heading" class="font-semibold">Limits</h2>
      </div>
      @if (savedText(); as saved) {
        <div class="border-b border-border px-4 py-3 md:px-5">
          <app-admin-alert
            #savedNotice
            kind="success"
            [title]="saved.title"
            [description]="saved.description"
          />
        </div>
      }
      <ul role="list" class="divide-y divide-border">
        @for (row of rows(); track row.field) {
          @if (editing() === row.field && editSpec(); as spec) {
            <li class="px-4 py-4 md:px-5">
              <app-limit-edit-form
                [spec]="spec"
                (cancelled)="closeEdit(row.field)"
                (saved)="savedLimit(row.field, $event)"
              />
            </li>
          } @else {
            <li class="flex items-start gap-3 px-4 py-3.5 md:px-5">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                ><ng-icon [name]="row.icon" class="text-lg" aria-hidden="true"
              /></span>
              <div class="min-w-0 flex-1">
                <h3 class="font-medium">{{ row.label }}</h3>
                <p class="mt-0.5 text-sm text-muted-foreground" [attr.data-testid]="row.testId">
                  {{ row.summary }}
                </p>
              </div>
              <button
                #editButton
                type="button"
                data-slot="button"
                [attr.data-limit]="row.field"
                [class]="outlineButton"
                (click)="openEdit(row.field)"
              >
                <ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Edit<span
                  class="sr-only"
                >
                  {{ row.label.toLowerCase() }}</span
                >
              </button>
            </li>
          }
        }
      </ul>
    </section>
  `,
})
export class SeasonLimits {
  private readonly injector = inject(Injector);
  private readonly setMaxTeams = injectMutation(api.seasons.setMaxTeams);
  private readonly setMaxRosterSize = injectMutation(api.seasons.setMaxRosterSize);

  readonly seasonId = input.required<Id<'seasons'>>();
  readonly maxTeams = input<number | undefined>(undefined);
  readonly teamCount = input.required<number>();
  readonly maxRosterSize = input<number | undefined>(undefined);
  readonly minimumRosterSize = input.required<number>();
  readonly largestRoster = input<LargestRoster | undefined>(undefined);
  readonly waitlistCount = input(0);

  protected readonly panel = PANEL;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly editing = signal<Limit | null>(null);
  protected readonly savedText = signal<AlertText | null>(null);

  protected readonly rows = computed<LimitRow[]>(() => [
    {
      field: 'maxTeams',
      icon: 'lucideUsersRound',
      label: 'Maximum teams',
      summary: maxTeamsSummary(this.maxTeams(), this.teamCount()),
      testId: 'max-teams-summary',
    },
    {
      field: 'maxRosterSize',
      icon: 'lucideUsers',
      label: 'Maximum roster size',
      summary: maxRosterSizeSummary(this.maxRosterSize()),
      testId: 'max-roster-size-summary',
    },
  ]);

  protected readonly editSpec = computed<LimitSpec | null>(() => {
    const seasonId = this.seasonId();
    switch (this.editing()) {
      case 'maxTeams':
        return {
          field: 'maxTeams',
          id: 'maximum-teams',
          label: 'Maximum teams',
          current: this.maxTeams(),
          description: maxTeamsDescription(this.teamCount()),
          check: (value) => checkMaxTeams(value)?.message ?? null,
          save: (maxTeams) => this.setMaxTeams.run({ seasonId, maxTeams }),
        };
      case 'maxRosterSize': {
        const minimum = this.minimumRosterSize();
        const largest = this.largestRoster();
        return {
          field: 'maxRosterSize',
          id: 'maximum-roster-size',
          label: 'Maximum roster size',
          current: this.maxRosterSize(),
          description: maxRosterSizeDescription(minimum, largest),
          check: (value) => checkMaxRosterSizeFor(value, minimum, largest ?? null)?.message ?? null,
          save: (maxRosterSize) => this.setMaxRosterSize.run({ seasonId, maxRosterSize }),
        };
      }
      case null:
        return null;
    }
  });

  private readonly editButtons = viewChildren<ElementRef<HTMLButtonElement>>('editButton');
  private readonly savedNotice = viewChild<AdminAlert>('savedNotice');

  protected openEdit(field: Limit): void {
    this.savedText.set(null);
    this.editing.set(field);
  }

  protected closeEdit(field: Limit): void {
    this.editing.set(null);
    afterNextRender(
      () =>
        this.editButtons()
          .find((button) => button.nativeElement.dataset['limit'] === field)
          ?.nativeElement.focus(),
      { injector: this.injector },
    );
  }

  /** The form is gone, so focus moves to the status. */
  protected savedLimit(field: Limit, value: number | null): void {
    this.editing.set(null);
    this.savedText.set(
      field === 'maxTeams'
        ? maxTeamsSavedText(value, {
            teamCount: this.teamCount(),
            waitlistCount: this.waitlistCount(),
          })
        : maxRosterSizeSavedText(value),
    );
    afterNextRender(() => this.savedNotice()?.focus(), { injector: this.injector });
  }
}
