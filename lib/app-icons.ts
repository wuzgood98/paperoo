export const BRAND_TILE_COLOR = "#141414";

export const BRAND_GLYPH_COLOR = "#ffffff";

/**
 * Manifest PNG icons. `any` icons match `app/icon.svg` (rounded tile, glyph at
 * 80%). `maskable` icons are full-bleed with the glyph at 60%, well inside the
 * W3C safe zone (a centred circle of radius 40%).
 */
export const appIcons = [
  { name: "icon-192.png", purpose: "any", size: 192 },
  { name: "icon-512.png", purpose: "any", size: 512 },
  { name: "maskable-192.png", purpose: "maskable", size: 192 },
  { name: "maskable-512.png", purpose: "maskable", size: 512 },
] as const;

export type AppIcon = (typeof appIcons)[number];

export const appIconSrc = (icon: AppIcon): string => `/icons/${icon.name}`;
