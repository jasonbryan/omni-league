// Vendored from spartan helm v1.9.0 (`libs/helm/breadcrumb`: breadcrumb, list, item, link, page, separator), with the Nova
// style's classes inlined as static strings in place of its `spartan-breadcrumb-*` names and `classes()`.
// Local changes, to keep when re-copying from upstream:
// - `hlmBreadcrumb` has no `role` (a `nav` has one): the page sets the nav's label, which keeps the capital "Breadcrumb"
//   (upstream's default is "breadcrumb");
// - `hlmBreadcrumbList` has `role="list"`, which Safari needs on a list with no bullets, and is `flex items-center text-sm
//   text-muted-foreground` without `flex-wrap`, `gap-1.5`, or `wrap-break-word`: each trail sets its own wrap and gap, so the
//   wrapping trails keep the heights their loading skeletons reserve;
// - `hlmBreadcrumbItem` has no `inline-flex items-center`: each trail keeps its own item display;
// - `hlmBreadcrumbLink` keeps upstream's `hover:text-foreground transition-colors`, which fades the hover colour over 150 ms;
//   each trail adds its own crumb class;
// - `hlmBreadcrumbPage` goes on the current `a` and stays a link: it has the `RouterLink` host directive, an `href`, and
//   `aria-current="page"`, and no `role="link"` or `aria-disabled`, so the current crumb keeps its Tab stop and navigates as it did.
//   It is `font-medium text-foreground` where upstream's Nova style is `font-normal`;
// - `hlmBreadcrumbSeparator` is on a `li` and draws `lucideChevronRight` at `translate-y-0.5 text-sm` when it has no content,
//   without `[&>ng-icon]:flex`, so the chevron stays where the trails had it;
// - `hlm-breadcrumb-ellipsis` is not copied, because no trail collapses.
import { HlmBreadcrumb } from './hlm-breadcrumb';
import { HlmBreadcrumbItem } from './hlm-breadcrumb-item';
import { HlmBreadcrumbLink } from './hlm-breadcrumb-link';
import { HlmBreadcrumbList } from './hlm-breadcrumb-list';
import { HlmBreadcrumbPage } from './hlm-breadcrumb-page';
import { HlmBreadcrumbSeparator } from './hlm-breadcrumb-separator';

export * from './hlm-breadcrumb';
export * from './hlm-breadcrumb-item';
export * from './hlm-breadcrumb-link';
export * from './hlm-breadcrumb-list';
export * from './hlm-breadcrumb-page';
export * from './hlm-breadcrumb-separator';

export const HlmBreadcrumbImports = [
  HlmBreadcrumb,
  HlmBreadcrumbItem,
  HlmBreadcrumbLink,
  HlmBreadcrumbList,
  HlmBreadcrumbPage,
  HlmBreadcrumbSeparator,
] as const;
