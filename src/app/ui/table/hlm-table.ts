import { Directive } from '@angular/core';

@Directive({
  selector: 'div[hlmTableContainer]',
  exportAs: 'hlmTableContainer',
  host: { role: 'region', tabindex: '0', class: 'relative w-full overflow-x-auto' },
})
export class HlmTableContainer {}

@Directive({
  selector: 'table[hlmTable]',
  exportAs: 'hlmTable',
  host: { class: 'w-full text-sm' },
})
export class HlmTable {}

@Directive({
  selector: 'thead[hlmTHead],thead[hlmTableHeader]',
  exportAs: 'hlmTHead',
})
export class HlmTHead {}

@Directive({
  selector: 'tbody[hlmTBody],tbody[hlmTableBody]',
  exportAs: 'hlmTBody',
})
export class HlmTBody {}

@Directive({
  selector: 'tr[hlmTr],tr[hlmTableRow]',
  exportAs: 'hlmTr',
  host: { class: 'border-b' },
})
export class HlmTr {}

@Directive({
  selector: 'th[hlmTh],th[hlmTableHead]',
  exportAs: 'hlmTh',
  host: { class: 'text-foreground h-10 px-2 font-medium' },
})
export class HlmTh {}

@Directive({
  selector: 'td[hlmTd],td[hlmTableCell]',
  exportAs: 'hlmTd',
  host: { class: 'p-2' },
})
export class HlmTd {}

@Directive({
  selector: 'caption[hlmCaption],caption[hlmTableCaption]',
  exportAs: 'hlmCaption',
  host: { class: 'text-muted-foreground mt-4 text-sm' },
})
export class HlmCaption {}
