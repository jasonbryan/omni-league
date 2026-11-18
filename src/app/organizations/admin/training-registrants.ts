import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, injectQuery } from '../../core/data/convex';
import { RegistrantsList } from './registrants-list';

@Component({
  selector: 'app-training-registrants',
  imports: [RegistrantsList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `<app-registrants-list
    [rows]="result.value()"
    [failed]="failed()"
    [subject]="className()"
    [retryHref]="retryHref()"
    [expected]="registered()"
    [kinds]="true"
  />`,
})
export class TrainingRegistrants {
  readonly trainingClassId = input.required<Id<'trainingClasses'>>();
  readonly className = input.required<string>();
  readonly retryHref = input.required<string>();
  readonly registered = input.required<number>();

  protected readonly result = injectQuery(api.trainingRegistrations.listForClass, () => ({
    trainingClassId: this.trainingClassId(),
  }));
  protected readonly failed = computed(() => this.result.error() !== undefined);
}
