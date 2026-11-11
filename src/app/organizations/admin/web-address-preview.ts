import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  inject,
  input,
} from '@angular/core';

// The break opportunities keep a long address wrapping at the path, not mid-word, on a phone.
@Component({
  selector: 'app-web-address-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block break-words text-foreground' },
  template: `{{ host }}/<wbr />{{ parentPath() }}<wbr /><strong class="font-semibold">{{
      slug()
    }}</strong>`,
})
export class WebAddressPreview {
  readonly parent = input.required<string>();
  readonly slug = input.required<string>();

  protected readonly host = inject(DOCUMENT).location.host;
  protected readonly parentPath = computed(() => `${this.parent().replace(/^\//, '')}/`);
}
