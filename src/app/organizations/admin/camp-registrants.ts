import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, injectQuery } from '../../core/data/convex';
import { RegistrantsList } from './registrants-list';

@Component({
  selector: 'app-camp-registrants',
  imports: [RegistrantsList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `<app-registrants-list
    [rows]="result.value()"
    [failed]="failed()"
    [subject]="sessionName()"
    [retryHref]="retryHref()"
    [expected]="registered()"
  />`,
})
export class CampRegistrants {
  readonly sessionId = input.required<Id<'campSessions'>>();
  readonly sessionName = input.required<string>();
  readonly retryHref = input.required<string>();
  readonly registered = input.required<number>();

  protected readonly result = injectQuery(api.campRegistrations.listForSession, () => ({
    sessionId: this.sessionId(),
  }));
  protected readonly failed = computed(() => this.result.error() !== undefined);
}
