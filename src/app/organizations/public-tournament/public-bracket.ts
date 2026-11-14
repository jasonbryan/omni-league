import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { PublicBracket as PublicBracketData } from '../../../../convex/lib/publicPage';
import { scoreText } from '../../../../convex/lib/sports';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';

const ROW = 'px-3 py-2';
const TEAM = `flex items-center justify-between gap-3 ${ROW}`;
type Game = PublicBracketData['rounds'][number]['games'][number];

@Component({
  selector: 'app-public-bracket',
  imports: [HlmBadge, HlmCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section id="bracket" aria-labelledby="bracket-heading" class="scroll-mt-20">
      <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="bracket-heading" class="text-xl font-semibold tracking-tight">Bracket</h2>
        @if (bracket()) {
          <p
            data-testid="bracket-scroll-hint"
            class="hidden text-sm text-muted-foreground md:block"
            [class.invisible]="!overflows()"
          >
            Scroll sideways for more rounds.
          </p>
        }
      </div>
      @if (bracket(); as bracket) {
        @if (bracket.winner; as winner) {
          <p data-testid="bracket-winner" class="mt-3 text-lg font-semibold">
            Winner: {{ winner }}
          </p>
        }
        <div
          #scroller
          data-testid="bracket-scroller"
          role="region"
          aria-label="Bracket rounds"
          tabindex="0"
          class="mt-4 flex flex-col gap-8 md:flex-row md:gap-6 md:overflow-x-auto md:pb-4"
        >
          @for (round of bracket.rounds; track round.name; let roundIndex = $index) {
            <section
              [attr.aria-labelledby]="'bracket-round-' + roundIndex"
              class="flex flex-col md:w-64 md:shrink-0"
            >
              <h3
                [id]="'bracket-round-' + roundIndex"
                class="text-sm font-medium text-muted-foreground"
              >
                {{ round.name }}
              </h3>
              <ol class="mt-3 flex flex-1 flex-col gap-3 md:justify-around">
                @for (game of round.games; track $index; let gameIndex = $index) {
                  <li
                    hlmCard
                    size="bare"
                    data-testid="bracket-game"
                    class="divide-y divide-border overflow-hidden"
                  >
                    <span class="sr-only">Game {{ gameIndex + 1 }}:</span>
                    @for (place of game.teams; track $index; let placeIndex = $index) {
                      <div
                        data-testid="bracket-team"
                        class="${TEAM}"
                        [class.font-semibold]="game.winner === placeIndex"
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
                            <span class="text-muted-foreground">{{
                              game.bye ? 'Bye' : 'To be decided'
                            }}</span>
                          }
                        </span>
                        @if (game.winner === placeIndex) {
                          <span hlmBadge variant="secondary" size="fit">Won</span>
                        }
                      </div>
                    }
                    @if (game.forfeit !== undefined) {
                      <div data-testid="bracket-score" class="${ROW} text-sm text-muted-foreground">
                        {{ forfeitText(game) }}
                      </div>
                    } @else if (game.score; as score) {
                      <div data-testid="bracket-score" class="${ROW} text-sm text-muted-foreground">
                        <span class="sr-only">Score: </span>{{ scoreText(score) }}
                      </div>
                    }
                  </li>
                }
              </ol>
            </section>
          }
        </div>
      } @else {
        <p class="mt-3 text-muted-foreground">
          The bracket appears here once the organizer creates it.
        </p>
      }
    </section>
  `,
})
export class PublicBracket {
  readonly bracket = input<PublicBracketData | undefined>(undefined);

  protected readonly scoreText = scoreText;

  protected forfeitText(game: Game): string {
    const team = game.forfeit === undefined ? null : game.teams[game.forfeit];
    return team ? `${team.name} forfeited` : 'Forfeit';
  }

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  /** Shown until the browser has measured the rounds, so a page with no script still carries the hint. */
  protected readonly overflows = signal(true);

  constructor() {
    afterRenderEffect((onCleanup) => {
      const element = this.scroller()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        this.overflows.set(element.scrollWidth > element.clientWidth),
      );
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }
}
