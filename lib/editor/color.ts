const HEX_CHANNEL_MAX = 255;
const LIGHTNESS_MAX = 100;
const HUE_SECTORS = 6;
const DEGREES_PER_SECTOR = 60;

export interface Hsl {
  h: number;
  l: number;
  s: number;
}

interface Rgb {
  b: number;
  g: number;
  r: number;
}

export const normalizeHex = (hex: string): string =>
  `#${hex.replace("#", "").toLowerCase().padEnd(6, "0")}`;

const parseHexChannels = (hex: string): Rgb => {
  const normalized = normalizeHex(hex).slice(1);
  return {
    b: Number.parseInt(normalized.slice(4, 6), 16) || 0,
    g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
    r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
  };
};

const channelToHex = (channel: number): string =>
  Math.round(channel).toString(16).padStart(2, "0");

export const hexToHsl = (hex: string): Hsl => {
  const { r, g, b } = parseHexChannels(hex);
  const red = r / HEX_CHANNEL_MAX;
  const green = g / HEX_CHANNEL_MAX;
  const blue = b / HEX_CHANNEL_MAX;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, l: Math.round(lightness * LIGHTNESS_MAX), s: 0 };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % HUE_SECTORS;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  if (hue < 0) {
    hue += HUE_SECTORS;
  }

  return {
    h: Math.round(hue * DEGREES_PER_SECTOR),
    l: Math.round(lightness * LIGHTNESS_MAX),
    s: Math.round(saturation * LIGHTNESS_MAX),
  };
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let next = t;
  if (next < 0) {
    next += 1;
  }
  if (next > 1) {
    next -= 1;
  }
  if (next < 1 / 6) {
    return p + (q - p) * 6 * next;
  }
  if (next < 1 / 2) {
    return q;
  }
  if (next < 2 / 3) {
    return p + (q - p) * (2 / 3 - next) * 6;
  }
  return p;
};

export const hslToHex = ({ h, l, s }: Hsl): string => {
  const saturation = s / LIGHTNESS_MAX;
  const lightness = l / LIGHTNESS_MAX;
  if (saturation === 0) {
    const channel = lightness * HEX_CHANNEL_MAX;
    const hex = channelToHex(channel);
    return `#${hex}${hex}${hex}`;
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const hue = h / 360;
  return `#${channelToHex(hueToRgb(p, q, hue + 1 / 3) * HEX_CHANNEL_MAX)}${channelToHex(hueToRgb(p, q, hue) * HEX_CHANNEL_MAX)}${channelToHex(hueToRgb(p, q, hue - 1 / 3) * HEX_CHANNEL_MAX)}`;
};

export const applyHslLightness = (hsl: Hsl, lightness: number): string =>
  hslToHex({ ...hsl, l: lightness });
