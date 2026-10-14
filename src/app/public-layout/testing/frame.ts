export interface PublicFrame {
  headers: number;
  mains: number;
  footers: number;
  navs: (string | null)[];
  menuButtons: number;
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
