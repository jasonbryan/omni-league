import { Directive } from '@angular/core';

export const SKELETON_CLASSES = 'bg-muted motion-safe:animate-pulse';

@Directive({
  selector: '[hlmSkeleton],hlm-skeleton',
  exportAs: 'hlmSkeleton',
  host: { class: SKELETON_CLASSES, 'data-slot': 'skeleton' },
})
export class HlmSkeleton {}
