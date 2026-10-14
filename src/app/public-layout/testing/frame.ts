/**
 * Test helper for the public layout: the landmarks and chrome of a rendered page, to compare
 * with `PUBLIC_FRAME`. A page in the public layout has one top bar (`header`), one `<main
 * id="main">`, one footer whose links are in the only navigation landmark (named "Footer"), and no
 * sidebar and no menu button.
 */
export interface PublicFrame {
  headers: number;
  mains: number;
  footers: number;
  /** The accessible names of every `nav`, in document order. */
  navs: (string | null)[];
  /** "Open navigation" buttons: the app shell's menu button, absent from the public layout. */
  menuButtons: number;
  /** Complementary landmarks: the sidebar's column. */
  asides: number;
}

export const PUBLIC_FRAME: PublicFrame = {
  headers: 1,
  mains: 1,
  footers: 1,
  navs: ['Footer'],
  menuButtons: 0,
  asides: 0,
};

export function publicFrame(root: ParentNode): PublicFrame {
  return {
    headers: root.querySelectorAll('header').length,
    mains: root.querySelectorAll('main#main[tabindex="-1"]').length,
    footers: root.querySelectorAll('footer').length,
    navs: [...root.querySelectorAll('nav')].map((nav) => nav.getAttribute('aria-label')),
    menuButtons: root.querySelectorAll('button[aria-label="Open navigation"]').length,
    asides: root.querySelectorAll('aside').length,
  };
}
