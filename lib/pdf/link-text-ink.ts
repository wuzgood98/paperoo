import type { PdfTextObject, PdfVectorObject, Rect } from "@/lib/editor/types";

/** Share of the smaller box that must overlap for a run to claim an outline. */
const MIN_OVERLAP_SHARE = 0.5;

const overlapArea = (left: Rect, right: Rect): number => {
  const width =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const height =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
};

const bestOutline = (
  run: PdfTextObject,
  outlines: readonly PdfVectorObject[]
): PdfVectorObject | null => {
  let best: PdfVectorObject | null = null;
  let bestArea = 0;
  for (const outline of outlines) {
    const area = overlapArea(run, outline);
    const smaller = Math.min(
      run.width * run.height,
      outline.width * outline.height
    );
    if (area > bestArea && smaller > 0 && area >= smaller * MIN_OVERLAP_SHARE) {
      best = outline;
      bestArea = area;
    }
  }
  return best;
};

/**
 * Pair runs whose glyphs paint nothing with the outline paths that do (see
 * `PdfVectorObject.textInk`). A paired run takes the outline's fill as its
 * color; pdf.js reports the text's own, meaningless, graphics-state color.
 */
export const linkTextInkOutlines = (
  runs: readonly PdfTextObject[],
  vectors: readonly PdfVectorObject[]
): PdfTextObject[] => {
  const outlines = vectors.filter((vector) => vector.textInk === true);
  if (outlines.length === 0) {
    return [...runs];
  }
  const pairs = new Map<string, PdfVectorObject>();
  const claims = new Map<string, number>();
  for (const run of runs) {
    if (run.invisibleGlyphs !== true) {
      continue;
    }
    const outline = bestOutline(run, outlines);
    if (outline) {
      pairs.set(run.id, outline);
      claims.set(outline.id, (claims.get(outline.id) ?? 0) + 1);
    }
  }
  return runs.map((run) => {
    const outline = pairs.get(run.id);
    if (!outline) {
      return run;
    }
    const color = outline.fill?.color ?? run.color;
    return {
      ...run,
      color,
      inkShared: (claims.get(outline.id) ?? 0) > 1,
      inkVectorId: outline.id,
      originalColor: color,
    };
  });
};
