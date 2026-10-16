import type { Rect } from "@/lib/editor/types";
import { readPixel, rgbToHex } from "@/lib/pdf/canvas-pixels";
import type { ImagePixelSource } from "@/lib/pdf/canvas-pixels";

/** Finer than caption ink so off-white paper stays distinct from pure white. */
const BACKGROUND_BUCKET = 8;

/** A flat cover is trustworthy when one color fills at least this much of the ring. */
export const COVER_COLOR_MIN_DOMINANCE = 0.7;

/** Device pixels sampled outside the cover so the text ink is not the background. */
export const COVER_SAMPLE_RING_PX = 3;

export interface SampledBackground {
  color: string;
  dominance: number;
}

export interface PdfTextCoverSample {
  color: string;
  uncertain: boolean;
}

const backgroundBucketChannel = (value: number): number =>
  Math.min(255, Math.round(value / BACKGROUND_BUCKET) * BACKGROUND_BUCKET);

const backgroundBucketKey = (r: number, g: number, b: number): string =>
  `${backgroundBucketChannel(r)},${backgroundBucketChannel(g)},${backgroundBucketChannel(b)}`;

/** One flag per sampled pixel, so exclusion costs rect area, not pixels × rects. */
const exclusionMask = (
  x0: number,
  y0: number,
  width: number,
  height: number,
  rects: readonly Rect[]
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  for (const rect of rects) {
    // Same pixel-inclusion rule as before: x >= rect.x && x < rect.x + width.
    const left = Math.max(x0, Math.ceil(rect.x));
    const top = Math.max(y0, Math.ceil(rect.y));
    const right = Math.min(x0 + width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(y0 + height, Math.ceil(rect.y + rect.height));
    // An empty span would hand `fill` a negative end, which counts from the end.
    if (right <= left) {
      continue;
    }
    for (let y = top; y < bottom; y += 1) {
      mask.fill(
        1,
        (y - y0) * width + (left - x0),
        (y - y0) * width + (right - x0)
      );
    }
  }
  return mask;
};

interface BackgroundBucket {
  b: number;
  count: number;
  g: number;
  r: number;
}

/**
 * Mode color of a ring around a cover. Near-white pixels count: they are the
 * page, not ink. `excludeRects` drops the cover itself and neighbouring runs.
 */
export const sampleBackground = (
  source: ImagePixelSource,
  ring: Rect,
  excludeRects: readonly Rect[]
): SampledBackground | null => {
  const x0 = Math.max(0, Math.floor(ring.x));
  const y0 = Math.max(0, Math.floor(ring.y));
  const x1 = Math.min(source.width, Math.ceil(ring.x + ring.width));
  const y1 = Math.min(source.height, Math.ceil(ring.y + ring.height));
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }

  const width = x1 - x0;
  const excluded = exclusionMask(x0, y0, width, y1 - y0, excludeRects);
  const buckets = new Map<string, BackgroundBucket>();
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (excluded[(y - y0) * width + (x - x0)] === 1) {
        continue;
      }
      const rgb = readPixel(source, x, y);
      if (!rgb) {
        continue;
      }
      const [r, g, b] = rgb;
      const key = backgroundBucketKey(r, g, b);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.b += b;
        bucket.count += 1;
        bucket.g += g;
        bucket.r += r;
      } else {
        buckets.set(key, { b, count: 1, g, r });
      }
      total += 1;
    }
  }
  if (total === 0) {
    return null;
  }

  let best: BackgroundBucket | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) {
      best = bucket;
    }
  }
  if (!best) {
    return null;
  }
  return {
    color: rgbToHex(
      best.r / best.count,
      best.g / best.count,
      best.b / best.count
    ),
    dominance: best.count / total,
  };
};

/** Cover color from a sampled ring; uncertain when no single color dominates. */
export const toCoverSample = (
  background: SampledBackground
): PdfTextCoverSample => ({
  color: background.color,
  uncertain: background.dominance < COVER_COLOR_MIN_DOMINANCE,
});
