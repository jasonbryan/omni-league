import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  api,
  injectOfflineCause,
  injectOnline,
  injectQuery,
  offlineLead,
} from '../../core/data/convex';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmTableImports } from '../../ui/table';
import { AdminAlert } from './admin-alert';
import { formatDay } from './format-day';

export const NO_REGISTRANTS_YET = 'No one has registered yet.';

const SKELETON_ROWS = [1, 2];

@Component({
  selector: 'app-camp-registrants',
  imports: [AdminAlert, HlmSkeleton, HlmTableImports],
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
        <div hlmTableContainer [attr.aria-label]="'Registrants of ' + sessionName()">
          <table hlmTable>
            <caption hlmCaption class="sr-only">
              Registrants of
              {{
                sessionName()
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
      <div aria-hidden="true" class="divide-y divide-border">
        @for (row of skeletonRows; track row) {
          <div class="py-3">
            <div hlmSkeleton class="h-4 w-40 max-w-full rounded-md"></div>
            <div hlmSkeleton class="mt-2 h-3.5 w-56 max-w-full rounded-md"></div>
          </div>
        }
      </div>
    }
  `,
})
export class CampRegistrants {
  readonly sessionId = input.required<Id<'campSessions'>>();
  readonly sessionName = input.required<string>();
  readonly retryHref = input.required<string>();

  private readonly cause = injectOfflineCause();
  private readonly result = injectQuery(api.campRegistrations.listForSession, () => ({
    sessionId: this.sessionId(),
  }));

  protected readonly online = injectOnline();
  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly day = formatDay;
  protected readonly noRegistrants = NO_REGISTRANTS_YET;
  protected readonly rows = this.result.value;
  protected readonly failed = computed(() => this.result.error() !== undefined);
  protected readonly offlineText = computed(
    () => `${offlineLead(this.cause())} The registrants will load when you’re connected.`,
  );

  protected guardianLine(guardian: { name: string; email: string }): string {
    return guardian.email === '' ? guardian.name : `${guardian.name}, ${guardian.email}`;
  }
}
