import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BracketGame } from './bracket-game';
import type { BracketSetup, ManagedTournament } from './tournament-context';

type Bracket = NonNullable<BracketSetup['bracket']>;

@Component({
  selector: 'app-bracket-rounds',
  imports: [BracketGame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @for (round of rounds(); track $index) {
      <section [attr.aria-labelledby]="idPrefix() + '-' + ($index + 1)" class="mt-4">
        <h4
          [id]="idPrefix() + '-' + ($index + 1)"
          class="text-sm font-medium text-muted-foreground"
        >
          {{ round.name }}
        </h4>
        <ol role="list" class="mt-2 flex flex-col gap-2">
          @for (game of round.games; track game.gameId) {
            <app-bracket-game
              [game]="game"
              [round]="round.round"
              [byes]="round.byes"
              [tournament]="tournament()"
            />
          }
        </ol>
      </section>
    }
  `,
})
export class BracketRounds {
  readonly bracket = input.required<Bracket>();
  readonly tournament = input.required<ManagedTournament>();
  /** Keeps the heading ids of two brackets on one page apart. */
  readonly idPrefix = input.required<string>();

  protected readonly rounds = computed(() => {
    const { rounds, losersRounds = [], grandFinalRounds = [] } = this.bracket();
    return [
      ...rounds.map((round) => ({ ...round, byes: true })),
      ...[...losersRounds, ...grandFinalRounds].map((round) => ({ ...round, byes: false })),
    ];
  });
}
