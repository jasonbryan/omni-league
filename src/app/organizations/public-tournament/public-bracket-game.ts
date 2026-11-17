import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PublicBracket } from '../../../../convex/lib/publicPage';
import { scoreText } from '../../../../convex/lib/sports';
import { HlmBadge } from '../../ui/badge';

export type PublicBracketGameData = PublicBracket['rounds'][number]['games'][number];

const ROW = 'px-3 py-2';
const TEAM = `flex items-center justify-between gap-3 ${ROW}`;

@Component({
  selector: 'app-public-bracket-game',
  imports: [HlmBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block divide-y divide-border' },
  template: `
    @if (visibleNumber()) {
      <span class="block ${ROW} text-sm text-muted-foreground">Game {{ number() }}</span>
    } @else {
      <span class="sr-only">Game {{ number() }}:</span>
    }
    @for (place of game().teams; track $index; let placeIndex = $index) {
      <div
        data-testid="bracket-team"
        class="${TEAM}"
        [class.font-semibold]="game().winner === placeIndex"
      >
        <span class="min-w-0 break-words">
          @if (placeIndex === 1) {
            <span class="sr-only">against</span>
          }
          @if (place) {
            @if (place.seed !== undefined) {
              <span class="text-muted-foreground">({{ place.seed }})</span>
            }
            {{ place.name }}
          } @else {
            <span class="text-muted-foreground">{{ game().bye ? 'Bye' : 'To be decided' }}</span>
          }
        </span>
        @if (game().winner === placeIndex) {
          <span hlmBadge variant="secondary" size="fit">Won</span>
        }
      </div>
    }
    @if (game().forfeit !== undefined) {
      <div data-testid="bracket-score" class="${ROW} text-sm text-muted-foreground">
        {{ forfeitText() }}
      </div>
    } @else if (game().score; as score) {
      <div data-testid="bracket-score" class="${ROW} text-sm text-muted-foreground">
        <span class="sr-only">Score: </span>{{ scoreText(score) }}
      </div>
    }
  `,
})
export class PublicBracketGame {
  readonly game = input.required<PublicBracketGameData>();
  readonly number = input.required<number>();
  readonly visibleNumber = input(false);

  protected readonly scoreText = scoreText;

  protected readonly forfeitText = computed(() => {
    const { forfeit, teams } = this.game();
    const team = forfeit === undefined ? null : teams[forfeit];
    return team ? `${team.name} forfeited` : 'Forfeit';
  });
}
