import type {
  EditorPage,
  PdfTextCaptionUnderline,
  Rect,
} from "@/lib/editor/types";

const NEAR_WHITE = 240;
const COLOR_BUCKET = 16;

export interface ImagePixelSource {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

export interface SampledCaptionInk {
  fill: string;
  underline: PdfTextCaptionUnderline;
}

const channelToHex = (value: number): string => {
  const clamped = Math.round(Math.min(255, Math.max(0, value)));
  return clamped.toString(16).padStart(2, "0");
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;

const bucketChannel = (value: number): number =>
  Math.min(255, Math.round(value / COLOR_BUCKET) * COLOR_BUCKET);

const bucketKey = (r: number, g: number, b: number): string =>
  `${bucketChannel(r)},${bucketChannel(g)},${bucketChannel(b)}`;

const isPaper = (r: number, g: number, b: number): boolean =>
  r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE;

const readPixel = (
  source: ImagePixelSource,
  x: number,
  y: number
): [number, number, number] | null => {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) {
    return null;
  }
  const index = (y * source.width + x) * 4;
  const r = source.data[index] ?? 0;
  const g = source.data[index + 1] ?? 0;
  const b = source.data[index + 2] ?? 0;
  return [r, g, b];
};

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

const findUnderlineInBand = (
  source: ImagePixelSource,
  originX: number,
  originY: number,
  bandWidth: number,
  localHeight: number,
  yStart: number,
  yEnd: number,
  preferredColor: string | null
): PdfTextCaptionUnderline | null => {
  const preferredBucket = preferredColor
    ? bucketKey(
        Number.parseInt(preferredColor.slice(1, 3), 16),
        Number.parseInt(preferredColor.slice(3, 5), 16),
        Number.parseInt(preferredColor.slice(5, 7), 16)
      )
    : null;

  let best: {
    color: string;
    rowCount: number;
    startRow: number;
  } | null = null;

  for (let y = yEnd - 1; y >= yStart; y -= 1) {
    const rowCounts = new Map<string, number>();
    const rowSamples = new Map<string, [number, number, number]>();
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
      rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
      rowSamples.set(key, rgb);
    }
    let rowBestKey: string | null = null;
    let rowBestCount = 0;
    for (const [key, count] of rowCounts) {
      if (count > rowBestCount) {
        rowBestKey = key;
        rowBestCount = count;
      }
    }
    if (!rowBestKey || rowBestCount < bandWidth * 0.35) {
      continue;
    }
    if (preferredBucket && rowBestKey !== preferredBucket) {
      continue;
    }
    const rgb = rowSamples.get(rowBestKey);
    if (!rgb) {
      continue;
    }
    const color = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (best?.color === color && best.startRow === y + 1) {
      best = { color, rowCount: best.rowCount + 1, startRow: y };
      continue;
    }
    if (!best || best.rowCount <= 1) {
      best = { color, rowCount: 1, startRow: y };
    }
  }

  if (!best) {
    return null;
  }
  const thickness = Math.max(1, best.rowCount);
  const centerRow = best.startRow + (thickness - 1) / 2;
  return {
    color: best.color,
    offsetFromRunTop: (centerRow + 0.5) / Math.max(1, localHeight),
    thickness: thickness / Math.max(1, localHeight),
  };
};

/**
 * Sample caption fill and underline from RGBA pixels. `rect` selects a sub-region
 * of `source` in pixel coordinates.
 */
export const sampleCaptionInk = (
  source: ImagePixelSource,
  rect: Rect
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

  const textBandEnd = Math.max(1, Math.floor(localHeight * 0.72));
  const underlineBandStart = Math.floor(localHeight * 0.65);
  const fill = dominantColorInBand(source, x0, y0, bandWidth, 0, textBandEnd);
  if (!fill) {
    return null;
  }
  const underline = findUnderlineInBand(
    source,
    x0,
    y0,
    bandWidth,
    localHeight,
    underlineBandStart,
    localHeight,
    fill
  ) ??
    findUnderlineInBand(
      source,
      x0,
      y0,
      bandWidth,
      localHeight,
      underlineBandStart,
      localHeight,
      null
    ) ?? {
      color: fill,
      offsetFromRunTop: 0.92,
      thickness: Math.max(1 / localHeight, 0.08),
    };

  return {
    fill,
    underline: {
      color: underline.color,
      offsetFromRunTop: underline.offsetFromRunTop * localHeight,
      thickness: Math.max(0.5, underline.thickness * localHeight),
    },
  };
};

export const displayedRectToCanvasPixels = (
  rect: Rect,
  page: Pick<EditorPage, "width">,
  canvas: HTMLCanvasElement,
  zoom: number
): Rect => {
  const ratio = canvas.width / Math.max(1, page.width * zoom);
  return {
    height: Math.max(1, Math.ceil(rect.height * zoom * ratio)),
    width: Math.max(1, Math.ceil(rect.width * zoom * ratio)),
    x: Math.floor(rect.x * zoom * ratio),
    y: Math.floor(rect.y * zoom * ratio),
  };
};

export const scaleCaptionInkToDisplayedBox = (
  ink: SampledCaptionInk,
  pixelHeight: number,
  displayedHeight: number
): SampledCaptionInk => {
  if (pixelHeight <= 0 || displayedHeight <= 0) {
    return ink;
  }
  const scale = displayedHeight / pixelHeight;
  return {
    fill: ink.fill,
    underline: {
      color: ink.underline.color,
      offsetFromRunTop: ink.underline.offsetFromRunTop * scale,
      thickness: Math.max(0.5, ink.underline.thickness * scale),
    },
  };
};
