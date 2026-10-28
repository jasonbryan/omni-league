/** Rows of every app sidebar, as drawn in `design/mockups/300-public-site-dashboard.html`; 44px tall on touch screens. */
const ROW = 'flex min-h-9 pointer-coarse:min-h-11 items-center gap-3 rounded-lg px-3 text-sm';

export const SIDEBAR_ROW = `${ROW} text-sidebar-foreground hover:bg-muted`;
export const SIDEBAR_ROW_CURRENT = `${ROW} bg-sidebar-accent font-medium text-sidebar-accent-foreground`;
export const SIDEBAR_ICON = 'shrink-0 text-lg text-muted-foreground';
export const SIDEBAR_ICON_CURRENT = 'shrink-0 text-lg';
/** The first link of a sidebar: the organization, or the app. */
export const SIDEBAR_HEAD = 'flex min-h-11 items-center gap-3 rounded-lg p-2 hover:bg-muted';
export const SIDEBAR_MARK =
  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground';
export const SIDEBAR_GROUP_LABEL = 'px-3 text-xs font-medium text-muted-foreground';
