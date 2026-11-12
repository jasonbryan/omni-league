// Vendored from spartan helm v1.9.0 (`libs/helm/pagination`: pagination, content, item, link, ellipsis), with the Nova style's
// classes inlined as static strings in place of its `spartan-pagination-*` names and `classes()`.
// Local changes, to keep when re-copying from upstream:
// - `hlmPagination` has no `hlm-pagination` element selector, no `role` (a `nav` has one), and no `mx-auto flex w-full justify-center`: the page sets the nav's label
//   (upstream's default is "pagination") and its own `justify-between` row with the range text;
// - `hlmPaginationContent` has `role="list"`, which Safari needs on a list with no bullets, and `gap-1` in place of Nova's `gap-0.5`;
// - `hlmPaginationLink` takes its classes from `GHOST_BUTTON`, `GHOST_ICON_BUTTON`, and `CURRENT_PAGE_BUTTON` in place of
//   `buttonVariants()`: the current page is the secondary button where upstream uses the outline variant, and Previous and Next
//   are the `default` size. It has no `relative` and no `cursor-pointer`, which a link with an `href` does not need, and an
//   `activated` output for its click, which the template lint rules do not accept as a `(click)` on an `a` they cannot see an `href` on;
// - `hlmPaginationEllipsis` is a component on a `span` (upstream: the `hlm-pagination-ellipsis` element) in a hidden gap item, with no "More pages" text, because the
//   gap is hidden from assistive technology, and it is `h-8 w-4 sm:w-8` in place of Nova's size;
// - `hlm-pagination-previous` and `hlm-pagination-next` are not copied: they compute classes with `hlm()`, take no `fragment`,
//   and have no disabled state, so Previous and Next are `hlmPaginationLink` anchors and `aria-disabled` spans;
// - `hlm-numbered-pagination` and the pagination config token are not copied: `pageWindow` in `page-control.ts` picks the window.
import { HlmPagination } from './hlm-pagination';
import { HlmPaginationContent } from './hlm-pagination-content';
import { HlmPaginationEllipsis } from './hlm-pagination-ellipsis';
import { HlmPaginationItem } from './hlm-pagination-item';
import { HlmPaginationLink } from './hlm-pagination-link';

export * from './hlm-pagination';
export * from './hlm-pagination-content';
export * from './hlm-pagination-ellipsis';
export * from './hlm-pagination-item';
export * from './hlm-pagination-link';

export const HlmPaginationImports = [
  HlmPagination,
  HlmPaginationContent,
  HlmPaginationEllipsis,
  HlmPaginationItem,
  HlmPaginationLink,
] as const;
