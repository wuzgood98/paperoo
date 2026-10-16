import type { PDFDocument } from "pdf-lib";

import { reusableCodePoints } from "@/lib/pdf/reuse-pdf-font";

/**
 * Characters the export can encode with `baseFontName` on source page
 * `sourceIndex`, as a sorted string. Empty when the font cannot be reused.
 */
export const probeFontGlyphs = (
  doc: PDFDocument,
  sourceIndex: number,
  baseFontName: string
): string => {
  if (sourceIndex < 0 || sourceIndex >= doc.getPageCount()) {
    return "";
  }
  return reusableCodePoints(doc.getPage(sourceIndex), baseFontName)
    .toSorted((left, right) => left - right)
    .map((point) => String.fromCodePoint(point))
    .join("");
};
