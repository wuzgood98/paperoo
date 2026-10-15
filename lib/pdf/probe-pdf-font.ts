import { PDFDocument } from "pdf-lib";

import { reusableCodePoints } from "@/lib/pdf/reuse-pdf-font";
import { pdfSession } from "@/lib/pdf/session";

interface ProbeCache {
  bytes: Uint8Array;
  doc: Promise<PDFDocument>;
  results: Map<string, string>;
}

let cache: ProbeCache | null = null;

const sessionCache = (bytes: Uint8Array): ProbeCache => {
  if (cache?.bytes !== bytes) {
    cache = {
      bytes,
      doc: PDFDocument.load(bytes, { updateMetadata: false }),
      results: new Map(),
    };
  }
  return cache;
};

/**
 * Characters the export can encode with `baseFontName` on source page
 * `sourceIndex`, run against the same pdf-lib lookup the export uses. Empty
 * when the font cannot be reused at all.
 */
export const probeReusableFontGlyphs = async (
  sourceIndex: number,
  baseFontName: string | undefined
): Promise<string> => {
  const { bytes } = pdfSession;
  if (!(bytes && baseFontName)) {
    return "";
  }
  const session = sessionCache(bytes);
  const key = `${sourceIndex}:${baseFontName}`;
  const known = session.results.get(key);
  if (known !== undefined) {
    return known;
  }
  const doc = await session.doc;
  if (sourceIndex < 0 || sourceIndex >= doc.getPageCount()) {
    return "";
  }
  const points = reusableCodePoints(doc.getPage(sourceIndex), baseFontName);
  const glyphs = points
    .toSorted((left, right) => left - right)
    .map((point) => String.fromCodePoint(point))
    .join("");
  session.results.set(key, glyphs);
  return glyphs;
};
