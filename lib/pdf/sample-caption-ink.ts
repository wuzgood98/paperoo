import type { PdfTextCaptionUnderline, Rect } from "@/lib/editor/types";
import { readPixel, rgbToHex } from "@/lib/pdf/canvas-pixels";
import type { ImagePixelSource } from "@/lib/pdf/canvas-pixels";

const NEAR_WHITE = 240;
const COLOR_BUCKET = 16;
/**
 * Share of the row width an underline row must ink. A rule spans the whole
 * run; glyph bottoms and descenders leave gaps between letters.
 */
const UNDERLINE_ROW_COVERAGE = 0.6;

export interface SampledCaptionInk {
  fill: string;
  /** Null when no rule was found below the baseline. */
  underline: PdfTextCaptionUnderline | null;
}

const bucketChannel = (value: number): number =>
  Math.min(255, Math.round(value / COLOR_BUCKET) * COLOR_BUCKET);

const bucketKey = (r: number, g: number, b: number): string =>
  `${bucketChannel(r)},${bucketChannel(g)},${bucketChannel(b)}`;

const isPaper = (r: number, g: number, b: number): boolean =>
  r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE;

/** Ink coverage of a pixel on white paper: 0 for paper, 1 for a solid color. */
const inkOf = (r: number, g: number, b: number): number =>
  (255 - Math.min(r, g, b)) / 255;

const dominantColorInBand = (
  source: ImagePixelSource,
  originX: number,
  originY: number,
  bandWidth: number,
  yStart: number,
  yEnd: number
): string | null => {
  const counts = new Map<string, number>();
  const samples = new Map<string, [number, number, number]>();
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = 0; x < bandWidth; x += 1) {
      const rgb = readPixel(source, originX + x, originY + y);
      if (!rgb) {
        continue;
      }
      const [r, g, b] = rgb;
      if (isPaper(r, g, b)) {
        continue;
      }
      const key = bucketKey(r, g, b);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      samples.set(key, rgb);
    }
  }
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (!bestKey || bestCount < 2) {
    return null;
  }
  const rgb = samples.get(bestKey);
  if (!rgb) {
    return null;
  }
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
};

interface RowInk {
  /** Mean ink across the row, 0..1. */
  ink: number;
  /** Share of the row's pixels that are not paper, 0..1. */
  coverage: number;
}

const rowInk = (
  source: ImagePixelSource,
  originX: number,
  y: number,
  bandWidth: number
): RowInk => {
  let ink = 0;
  let inked = 0;
  for (let x = 0; x < bandWidth; x += 1) {
    const rgb = readPixel(source, originX + x, y);
    if (!rgb) {
      continue;
    }
    const [r, g, b] = rgb;
    if (isPaper(r, g, b)) {
      continue;
    }
    ink += inkOf(r, g, b);
    inked += 1;
  }
  return { coverage: inked / bandWidth, ink: ink / bandWidth };
};

/** Darkest non-paper color in one row; the rule's solid core. */
const darkestColorInRow = (
  source: ImagePixelSource,
  originX: number,
  y: number,
  bandWidth: number
): string | null => {
  let darkest: [number, number, number] | null = null;
  let darkestInk = 0;
  for (let x = 0; x < bandWidth; x += 1) {
    const rgb = readPixel(source, originX + x, y);
    if (!rgb) {
      continue;
    }
    const ink = inkOf(rgb[0], rgb[1], rgb[2]);
    if (ink > darkestInk) {
      darkest = rgb;
      darkestInk = ink;
    }
  }
  return darkest ? rgbToHex(darkest[0], darkest[1], darkest[2]) : null;
};

/**
 * The first run of full-width ink rows at or below `yStart`, in pixels from
 * the band top. Center and thickness come from the ink-weighted rows, so
 * anti-aliased edges land between pixel rows instead of snapping to one.
 */
const findUnderlineBelow = (
  source: ImagePixelSource,
  originX: number,
  originY: number,
  bandWidth: number,
  yStart: number,
  yEnd: number
): PdfTextCaptionUnderline | null => {
  let weighted = 0;
  let total = 0;
  let peakInk = 0;
  let peakRow = -1;
  for (let y = yStart; y < yEnd; y += 1) {
    const row = rowInk(source, originX, originY + y, bandWidth);
    if (row.coverage < UNDERLINE_ROW_COVERAGE) {
      if (total > 0) {
        break;
      }
      continue;
    }
    weighted += (y + 0.5) * row.ink;
    total += row.ink;
    if (row.ink > peakInk) {
      peakInk = row.ink;
      peakRow = y;
    }
  }
  if (total <= 0 || peakRow < 0) {
    return null;
  }
  const color = darkestColorInRow(
    source,
    originX,
    originY + peakRow,
    bandWidth
  );
  if (!color) {
    return null;
  }
  return {
    color,
    offsetFromRunTop: weighted / total,
    thickness: total / peakInk,
  };
};

/**
 * Sample caption fill and underline from RGBA pixels. `rect` selects a
 * sub-region of `source` in pixel coordinates; `baselineRow` is the text
 * baseline in pixels from the top of `rect`. Fill is read above the
 * baseline and the underline only below it, so glyph bottoms are never
 * mistaken for the rule. Results are in pixels from the top of `rect`.
 */
export const sampleCaptionInk = (
  source: ImagePixelSource,
  rect: Rect,
  baselineRow: number
): SampledCaptionInk | null => {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(source.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(source.height, Math.ceil(rect.y + rect.height));
  const bandWidth = x1 - x0;
  const localHeight = y1 - y0;
  if (bandWidth <= 0 || localHeight <= 0) {
    return null;
  }
  const baseline = Math.min(localHeight, Math.max(1, Math.round(baselineRow)));
  const fill = dominantColorInBand(source, x0, y0, bandWidth, 0, baseline);
  if (!fill) {
    return null;
  }
  return {
    fill,
    underline: findUnderlineBelow(
      source,
      x0,
      y0,
      bandWidth,
      baseline,
      localHeight
    ),
  };
};
