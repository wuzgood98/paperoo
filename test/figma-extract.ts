import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import type {
  EditorPage,
  PdfTextObject,
  PdfVectorObject,
} from "@/lib/editor/types";
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
import {
  attachRemovalTargets,
  indexPageRemovals,
} from "@/lib/pdf/removal-targets";

import { loadPdfJsDocument } from "./pdfjs-node";

const TYPE3_METRIC_OPS = new Set([OPS.setCharWidth, OPS.setCharWidthAndBounds]);

/** The PdfSession pipeline for page 1, minus paints and images. */
export const extractFigmaPage = async (
  bytes: Uint8Array
): Promise<{
  page: EditorPage;
  runs: PdfTextObject[];
  vectors: PdfVectorObject[];
}> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const pdfPage = await pdf.getPage(1);
  const [content, operatorList] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const fontFaces = await collectPdfFontFaces(
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    pdfPage.commonObjs as PdfJsFontObjectStore,
    extractable.items,
    TYPE3_METRIC_OPS
  );
  const paintless = new Set<string>();
  for (const [id, face] of Object.entries(fontFaces)) {
    if (face.paintsNothing === true) {
      paintless.add(id);
    }
  }
  const [x0, y0, x1, y1] = pdfPage.view;
  const cropBox = { height: y1 - y0, width: x1 - x0, x: x0, y: y0 };
  const target = { cropBox, id: "page-1", sourceRotate: 0 as const };
  const extracted = extractPdfVectorObjects(
    operatorList,
    target,
    toPdfVectorOps(OPS),
    paintless
  );
  const index = indexPageRemovals(operatorList, OPS);
  const { runs, vectors } = attachRemovalTargets(
    index,
    linkTextInkOutlines(
      extractPdfTextObjects(extractable, target, fontFaces),
      extracted
    ),
    extracted
  );
  await task.destroy();
  const page: EditorPage = {
    contentOpCounts: index.counts,
    cropBox,
    height: cropBox.height,
    id: "page-1",
    objects: [],
    pdfAnnotationObjects: [],
    pdfImageObjects: [],
    pdfTextObjects: runs,
    pdfVectorObjects: vectors,
    rotation: 0,
    skippedPdfAnnotationSubtypes: [],
    sourceIndex: 0,
    sourceRotate: 0,
    width: cropBox.width,
  };
  return { page, runs, vectors };
};
