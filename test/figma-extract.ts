import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { PdfTextObject, PdfVectorObject } from "@/lib/editor/types";
import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";
import { linkTextInkOutlines } from "@/lib/pdf/link-text-ink";

import { loadPdfJsDocument } from "./pdfjs-node";

const TYPE3_METRIC_OPS = new Set([OPS.setCharWidth, OPS.setCharWidthAndBounds]);

/** The PdfSession pipeline for page 1, minus paints and images. */
export const extractFigmaPage = async (
  bytes: Uint8Array
): Promise<{ runs: PdfTextObject[]; vectors: PdfVectorObject[] }> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const [content, operatorList] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const fontFaces = await collectPdfFontFaces(
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    page.commonObjs as PdfJsFontObjectStore,
    extractable.items,
    TYPE3_METRIC_OPS
  );
  const paintless = new Set(
    Object.entries(fontFaces)
      .filter(([, face]) => face.paintsNothing === true)
      .map(([id]) => id)
  );
  const [x0, y0, x1, y1] = page.view;
  const target = {
    cropBox: { height: y1 - y0, width: x1 - x0, x: x0, y: y0 },
    id: "page-1",
    sourceRotate: 0 as const,
  };
  const vectors = extractPdfVectorObjects(
    operatorList,
    target,
    toPdfVectorOps(OPS),
    paintless
  );
  const runs = linkTextInkOutlines(
    extractPdfTextObjects(extractable, target, fontFaces),
    vectors
  );
  await task.destroy();
  return { runs, vectors };
};
