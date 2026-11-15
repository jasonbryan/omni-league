import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PublicPool } from '../../../../convex/lib/publicPage';
import { HlmTableImports } from '../../ui/table';
import { NO_STANDINGS_YET, columnKey, poolGameResultText, poolHasResult } from './public-pool-text';

const NUMBER_CELL = 'text-center tabular-nums whitespace-nowrap';

@Component({
  selector: 'app-public-pools',
  imports: [HlmTableImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (pools(); as pools) {
      <section id="pools" aria-labelledby="pools-heading" class="scroll-mt-20">
        <h2 id="pools-heading" class="text-xl font-semibold tracking-tight">Pools</h2>
        @for (pool of pools; track pool.pool) {
          <section [attr.aria-labelledby]="'pool-' + pool.pool" data-testid="pool" class="mt-6">
            <h3 [id]="'pool-' + pool.pool" class="text-lg font-semibold">Pool {{ pool.pool }}</h3>
            @if (hasResult(pool)) {
              <div hlmTableContainer class="mt-3">
                <table hlmTable data-testid="standings">
                  <caption hlmCaption class="sr-only">
                    Pool
                    {{
                      pool.pool
                    }}
                    standings
                  </caption>
                  <thead hlmTHead>
                    <tr hlmTr>
                      <th hlmTh scope="col" class="text-center whitespace-nowrap">
                        <span class="sr-only">Place</span><span aria-hidden="true">#</span>
                      </th>
                      <th hlmTh scope="col" class="text-start">Team</th>
                      @for (column of pool.columns; track column.short) {
                        <th hlmTh scope="col" class="${NUMBER_CELL}">
                          <span aria-hidden="true">{{ column.short }}</span
                          ><span class="sr-only">{{ column.label }}</span>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (row of pool.standings; track $index) {
                      <tr hlmTr data-testid="standing">
                        <td hlmTd class="${NUMBER_CELL}">{{ row.place }}</td>
                        <th hlmTh scope="row" class="text-start">{{ row.name }}</th>
                        @for (cell of row.cells; track $index) {
                          <td hlmTd class="${NUMBER_CELL}">{{ cell }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p data-testid="standings-key" class="mt-2 text-sm text-muted-foreground">
                {{ key(pool) }}
              </p>
              <p class="mt-1 text-sm text-muted-foreground">{{ pool.tiebreakers }}</p>
            } @else {
              <p data-testid="no-standings" class="mt-3 text-muted-foreground">
                {{ noStandings }}
              </p>
            }
            <h4 class="mt-5 text-sm font-medium text-muted-foreground">
              Games in Pool {{ pool.pool }}
            </h4>
            <ol role="list" class="mt-2 flex flex-col gap-2">
              @for (game of pool.games; track $index) {
                <li
                  data-testid="pool-game"
                  class="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p class="text-muted-foreground tabular-nums">Round {{ game.round }}</p>
                  <p class="font-medium">{{ game.teams[0] }} v {{ game.teams[1] }}</p>
                  @if (resultText(game); as result) {
                    <p data-testid="pool-game-result" class="text-muted-foreground">{{ result }}</p>
                  }
                </li>
              }
            </ol>
          </section>
        }
      </section>
    }
  `,
})
export class PublicPools {
  readonly pools = input<readonly PublicPool[] | undefined>(undefined);

  protected readonly hasResult = poolHasResult;
  protected readonly resultText = poolGameResultText;
  protected readonly key = columnKey;
  protected readonly noStandings = NO_STANDINGS_YET;
}
