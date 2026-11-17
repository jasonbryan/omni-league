import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import type { PublicBracket as PublicBracketData } from '../../../../convex/lib/publicPage';
import { HlmCard } from '../../ui/card';
import { PublicBracketGame } from './public-bracket-game';

type GrandFinal = NonNullable<PublicBracketData['grandFinal']>;

const SECTION_HEADING = 'text-lg font-semibold tracking-tight';
const ROUND_HEADING = 'text-sm font-medium text-muted-foreground';

@Component({
  selector: 'app-public-bracket',
  imports: [HlmCard, NgTemplateOutlet, PublicBracketGame],
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
        @if (bracket.grandFinal; as grandFinal) {
          <div class="mt-6 flex flex-col gap-10">
            <section aria-labelledby="bracket-winners-heading">
              <h3 id="bracket-winners-heading" class="${SECTION_HEADING}">Winners’ bracket</h3>
              <ng-container
                [ngTemplateOutlet]="rounds"
                [ngTemplateOutletContext]="{
                  rounds: bracket.rounds,
                  label: 'Winners’ bracket rounds',
                  idPrefix: 'bracket-winners-round',
                  nested: true,
                }"
              />
            </section>
            @if (bracket.losers; as losers) {
              <section aria-labelledby="bracket-losers-heading">
                <h3 id="bracket-losers-heading" class="${SECTION_HEADING}">Losers’ bracket</h3>
                <ng-container
                  [ngTemplateOutlet]="rounds"
                  [ngTemplateOutletContext]="{
                    rounds: losers,
                    label: 'Losers’ bracket rounds',
                    idPrefix: 'bracket-losers-round',
                    nested: true,
                  }"
                />
              </section>
            }
            <section aria-labelledby="bracket-grand-final-heading">
              <h3 id="bracket-grand-final-heading" class="${SECTION_HEADING}">Grand final</h3>
              <ol class="mt-4 flex flex-col gap-3 md:w-64">
                @for (game of grandFinal.games; track $index; let gameIndex = $index) {
                  <li hlmCard size="bare" data-testid="bracket-game" class="overflow-hidden">
                    <app-public-bracket-game
                      [game]="game"
                      [number]="gameIndex + 1"
                      [visibleNumber]="grandFinal.decidingGameIfNeeded"
                    />
                  </li>
                }
              </ol>
              @if (decidingGamePending(grandFinal)) {
                <p data-testid="grand-final-note" class="mt-3 text-sm text-muted-foreground">
                  Game 2 is played only if the losers’ bracket team wins game 1.
                </p>
              }
            </section>
          </div>
        } @else {
          <ng-container
            [ngTemplateOutlet]="rounds"
            [ngTemplateOutletContext]="{
              rounds: bracket.rounds,
              label: 'Bracket rounds',
              idPrefix: 'bracket-round',
              nested: false,
            }"
          />
        }
      } @else {
        <p class="mt-3 text-muted-foreground">
          The bracket appears here once the organizer creates it.
        </p>
      }
    </section>

    <ng-template
      #rounds
      let-rounds="rounds"
      let-label="label"
      let-idPrefix="idPrefix"
      let-nested="nested"
    >
      <div
        #scroller
        data-testid="bracket-scroller"
        role="region"
        [attr.aria-label]="label"
        tabindex="0"
        class="mt-4 flex flex-col gap-8 md:flex-row md:gap-6 md:overflow-x-auto md:pb-4"
      >
        @for (round of rounds; track round.name; let roundIndex = $index) {
          <section
            [attr.aria-labelledby]="idPrefix + '-' + roundIndex"
            class="flex flex-col md:w-64 md:shrink-0"
          >
            @if (nested) {
              <h4 [id]="idPrefix + '-' + roundIndex" class="${ROUND_HEADING}">{{ round.name }}</h4>
            } @else {
              <h3 [id]="idPrefix + '-' + roundIndex" class="${ROUND_HEADING}">{{ round.name }}</h3>
            }
            <ol class="mt-3 flex flex-1 flex-col gap-3 md:justify-around">
              @for (game of round.games; track $index; let gameIndex = $index) {
                <li hlmCard size="bare" data-testid="bracket-game" class="overflow-hidden">
                  <app-public-bracket-game [game]="game" [number]="gameIndex + 1" />
                </li>
              }
            </ol>
          </section>
        }
      </div>
    </ng-template>
  `,
})
export class PublicBracket {
  readonly bracket = input<PublicBracketData | undefined>(undefined);

  protected decidingGamePending({ games, decidingGameIfNeeded }: GrandFinal): boolean {
    return decidingGameIfNeeded && games.length === 1 && games[0].winner === undefined;
  }

  private readonly scrollers = viewChildren<ElementRef<HTMLElement>>('scroller');
  /** Shown until the browser has measured the rounds, so a page with no script still carries the hint. */
  protected readonly overflows = signal(true);

  constructor() {
    afterRenderEffect((onCleanup) => {
      const elements = this.scrollers().map(({ nativeElement }) => nativeElement);
      if (elements.length === 0 || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        this.overflows.set(elements.some((element) => element.scrollWidth > element.clientWidth)),
      );
      for (const element of elements) observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }
}
