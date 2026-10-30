/** The organization of the demo data that shows a logo; the others keep their initials, so both marks show. */
export const DEMO_LOGO_ORGANIZATION_SLUG = 'gulf-coast-sport-social';

/** A 64 by 64 PNG: a sun over the sea, in the colours of the identity mockup. */
const DEMO_LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABHUlEQVR42u3byxHCIBRG4VuBLdmHLViVRViKRViA6zjZZJPJA7gQuP9hhqWTnE+NEcUsc9wez6mnaTVHb7HNUEYNd4GIEp+FEC0+CSFq/CmE6PG7CCrxmwjSAGrxKwQAAABAF0A1fkG4+gR+77sWwBx8NEMCnAm/AsJ6jW+FYD3Ht0Cw3uNrIwAwQnxNBAAAAGCM+FoIvAIAAAAA7gQB4Nsg6wGsCLEmyKowvwsAAIDDPBq1g1KPba3Ca0LkjAWg9GRSAr0hSo89D8s9mZKYUgjPx5uHovez2PLY5vE+GvkaYh5X0pE/RbgPkAeYx/fzmhTn8i8xAAAAQBtAEWG1X0AeQAlhd9+QdHx0hKS9g9Lx0RCK9xDLho+EktvxB175GIb3d21PAAAAAElFTkSuQmCC';

export function demoLogoBytes(): Uint8Array {
  return Uint8Array.from(atob(DEMO_LOGO_PNG_BASE64), (char) => char.charCodeAt(0));
}
