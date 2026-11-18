import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { injectOfflineCause, injectOnline, offlineLead } from '../../core/data/convex';
import { HlmBadge } from '../../ui/badge';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmTableImports } from '../../ui/table';
import { AdminAlert } from './admin-alert';
import { formatDay } from './format-day';

export const NO_REGISTRANTS_YET = 'No one has registered yet.';

/** A class holds at most 200 places, the most any list has rows. */
const MAX_SKELETON_ROWS = 200;

export interface RegistrantRow {
  registrationId: string;
  name: string;
  kind?: 'series' | 'class';
  guardian?: { name: string; email: string };
  registeredAt: number;
}

@Component({
  selector: 'app-registrants-list',
  imports: [AdminAlert, HlmBadge, HlmSkeleton, HlmTableImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (failed()) {
      <app-admin-alert
        kind="error"
        title="The registrants could not be loaded."
        description="Check your connection and try again."
        ><a
          [href]="retryHref()"
          class="font-medium underline underline-offset-4 pointer-coarse:min-h-11"
          >Try again</a
        ></app-admin-alert
      >
    } @else if (rows(); as rows) {
      @if (rows.length > 0) {
        <div hlmTableContainer [attr.aria-label]="'Registrants of ' + subject()">
          <table hlmTable>
            <caption hlmCaption class="sr-only">
              Registrants of
              {{
                subject()
              }}
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col" class="text-start">Name</th>
                <th hlmTh scope="col" class="text-end whitespace-nowrap">Registered</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (row of rows; track row.registrationId) {
                <tr hlmTr data-slot="registrant">
                  <th hlmTh scope="row" class="text-start">
                    {{ row.name }}
                    @if (row.kind; as kind) {
                      <span
                        hlmBadge
                        [variant]="kind === 'series' ? 'secondary' : 'outline'"
                        data-slot="registrant-kind"
                        class="ms-1.5 align-middle"
                        >{{ kind === 'series' ? 'Series' : 'This class' }}</span
                      >
                    }
                    @if (row.guardian; as guardian) {
                      <span
                        data-slot="registrant-guardian"
                        class="block font-normal wrap-anywhere text-muted-foreground"
                        >Guardian: {{ guardianLine(guardian) }}</span
                      >
                    }
                  </th>
                  <td hlmTd class="text-end whitespace-nowrap">{{ day(row.registeredAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p data-slot="registrants-empty" class="py-2 text-muted-foreground">
          {{ noRegistrants }}
        </p>
      }
    } @else if (!online()) {
      <p role="status" data-slot="registrants-offline" class="py-2 text-muted-foreground">
        {{ offlineText() }}
      </p>
    } @else {
      <p role="status" class="sr-only">Loading the registrants.</p>
      @if (skeletonRows().length === 0) {
        <div aria-hidden="true" class="py-2">
          <div hlmSkeleton class="h-lh w-56 max-w-full rounded-md"></div>
        </div>
      } @else {
        <div aria-hidden="true">
          <table hlmTable>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col" class="text-start">Name</th>
                <th hlmTh scope="col" class="text-end whitespace-nowrap">Registered</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (row of skeletonRows(); track row) {
                <tr hlmTr>
                  <th hlmTh scope="row">
                    <div hlmSkeleton class="h-4 w-40 max-w-full rounded-md"></div>
                  </th>
                  <td hlmTd class="text-end">
                    <div hlmSkeleton class="ms-auto h-4 w-20 rounded-md"></div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
})
export class RegistrantsList {
  /** `undefined` until the list answers. */
  readonly rows = input.required<readonly RegistrantRow[] | undefined>();
  readonly failed = input.required<boolean>();
  readonly subject = input.required<string>();
  readonly retryHref = input.required<string>();
  /** The count the page already shows, so the skeleton takes the room the rows will. */
  readonly expected = input.required<number>();

  private readonly cause = injectOfflineCause();

  protected readonly online = injectOnline();
  protected readonly skeletonRows = computed(() =>
    Array.from({ length: Math.min(this.expected(), MAX_SKELETON_ROWS) }, (_, index) => index),
  );
  protected readonly day = formatDay;
  protected readonly noRegistrants = NO_REGISTRANTS_YET;
  protected readonly offlineText = computed(
    () => `${offlineLead(this.cause())} The registrants will load when you’re connected.`,
  );

  protected guardianLine(guardian: { name: string; email: string }): string {
    return guardian.email === '' ? guardian.name : `${guardian.name}, ${guardian.email}`;
  }
}
