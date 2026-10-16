import type { PdfVectorObject } from "@/lib/editor/types";
import type { EngineOcrPage } from "@/lib/ocr/from-engine";
import { boxOf, inkedSubpaths } from "@/lib/ocr/outline-text";
import type { OcrOutlineLine } from "@/lib/ocr/outline-text";

/** Where an outline sits in the bitmap OCR reads: user space → pixels. */
export interface OutlineRasterFrame {
  height: number;
  /** User-space x at the bitmap's left edge. */
  left: number;
  /** Pixels per user unit. */
  scale: number;
  /** User-space y at the bitmap's top edge. */
  top: number;
  width: number;
}

/** Blank margin around the ink, in user units: Tesseract misses edge glyphs. */
const RASTER_PAD = 4;
/** Aim for typical glyph pieces about this many pixels tall. */
const TARGET_GLYPH_PX = 24;
const MIN_SCALE = 2;
const MAX_SCALE = 8;
const MAX_EDGE_PX = 4000;

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * The bitmap for recognizing one outline alone: no page art around it, its
 * glyphs large enough for Tesseract, the long edge capped.
 */
export const outlineRasterFrame = (
  vector: Pick<PdfVectorObject, "commands">
): OutlineRasterFrame | null => {
  const subpaths = inkedSubpaths(vector.commands);
  if (subpaths.length === 0) {
    return null;
  }
  const box = boxOf(subpaths);
  const glyphHeight = median(
    subpaths.map((subpath) => subpath.maxY - subpath.minY)
  );
  const userWidth = box.maxX - box.minX + RASTER_PAD * 2;
  const userHeight = box.maxY - box.minY + RASTER_PAD * 2;
  const wanted = glyphHeight > 0 ? TARGET_GLYPH_PX / glyphHeight : MAX_SCALE;
  const scale = Math.min(
    Math.max(wanted, MIN_SCALE),
    MAX_SCALE,
    MAX_EDGE_PX / Math.max(userWidth, userHeight)
  );
  return {
    height: Math.ceil(userHeight * scale),
    left: box.minX - RASTER_PAD,
    scale,
    top: box.maxY + RASTER_PAD,
    width: Math.ceil(userWidth * scale),
  };
};

/** Map a bitmap point back to user space. */
const toUser = (frame: OutlineRasterFrame, x: number, y: number) => ({
  x: frame.left + x / frame.scale,
  y: frame.top - y / frame.scale,
});

/** Tesseract's lines for an outline bitmap, in the outline's user space. */
export const outlineLinesFromEngine = (
  page: EngineOcrPage,
  frame: OutlineRasterFrame
): OcrOutlineLine[] => {
  const lines: OcrOutlineLine[] = [];
  for (const block of page.blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words.filter((word) => word.text.trim() !== "");
        if (words.length === 0) {
          continue;
        }
        const topLeft = toUser(frame, line.bbox.x0, line.bbox.y0);
        const bottomRight = toUser(frame, line.bbox.x1, line.bbox.y1);
        lines.push({
          box: {
            maxX: Math.max(topLeft.x, bottomRight.x),
            maxY: Math.max(topLeft.y, bottomRight.y),
            minX: Math.min(topLeft.x, bottomRight.x),
            minY: Math.min(topLeft.y, bottomRight.y),
          },
          confidence:
            words.reduce((total, word) => total + word.confidence, 0) /
            words.length,
          text: words.map((word) => word.text.trim()).join(" "),
        });
      }
    }
  }
  return lines;
};
