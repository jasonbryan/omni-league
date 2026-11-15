// Vendored from spartan helm v1.9.0 (`libs/helm/table`: table, container, header, body, row, head, cell, caption), with the Nova style's classes
// (`libs/registry/src/styles/style-nova.css`) inlined in place of its `spartan-table-*` names.
// Local changes, to keep when re-copying from upstream:
// - no `hlmTFoot`, which no table uses;
// - static host classes, so a chunk that uses them carries no class-merging code, in place of `classes()`;
// - the row has no hover colour, selected colour, or expanded colour, because a table row here is not interactive, and the head and cell drop the checkbox padding rule;
// - no `data-slot` attributes, which nothing here selects on, and none of the classes the app's stylesheet does not already carry other than the container's `overflow-x-auto`, to keep the initial stylesheet from growing:
//   the header and body border rules (each row carries its own bottom border, so the last row closes the table), the caption and vertical alignment rules (a caption here is for screen readers only, and cells align to the middle by default),
//   no-wrap on the head and cell, which a page asks for where a cell must not break, and start alignment on the head, which a page asks for where the column is text.
import {
  HlmCaption,
  HlmTable,
  HlmTableContainer,
  HlmTBody,
  HlmTd,
  HlmTh,
  HlmTHead,
  HlmTr,
} from './hlm-table';

export * from './hlm-table';

export const HlmTableImports = [
  HlmCaption,
  HlmTableContainer,
  HlmTable,
  HlmTBody,
  HlmTd,
  HlmTh,
  HlmTHead,
  HlmTr,
] as const;
