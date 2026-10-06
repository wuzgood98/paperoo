import { expect, test } from "vitest";

import { selectPdfObjectAtPoint } from "@/components/editor/overlay-pdf-hit";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfImageObject } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";

const scannedPage = (): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [
    {
      deleted: false,
      height: 792,
      id: "img-1",
      originalHeight: 792,
      originalRotation: 0,
      originalWidth: 612,
      originalX: 0,
      originalY: 0,
      pageId: "page-1",
      previewAssetId: null,
      replacementAssetId: null,
      rotation: 0,
      sourceId: "Im1",
      sourceIndex: 0,
      type: "pdf-image",
      width: 612,
      x: 0,
      y: 0,
    } satisfies PdfImageObject,
  ],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

const word = (): OcrTextObject => ({
  baselineY: 40,
  height: 16,
  id: "ocr-1",
  lineId: "line-1",
  pageId: "page-1",
  source: "ocr",
  text: "Hello",
  type: "ocr-text",
  width: 40,
  x: 10,
  y: 10,
});

test("OCR word hit runs before the full-page scan image", () => {
  const page = scannedPage();
  editorStore.resetDocument([page], "scan.pdf");
  const hit = selectPdfObjectAtPoint(
    page,
    { x: 20, y: 18 },
    { ocrWords: [word()] }
  );
  expect(hit).toBe(true);
  expect(editorStore.getState().selectedOcrWordIds).toEqual(["ocr-1"]);
  expect(editorStore.getState().selectedPdfImageId).toBeNull();
  editorStore.clearDocument();
});

test("a click in the scan margin still selects the image", () => {
  const page = scannedPage();
  editorStore.resetDocument([page], "scan.pdf");
  const hit = selectPdfObjectAtPoint(
    page,
    { x: 400, y: 400 },
    {
      ocrWords: [word()],
    }
  );
  expect(hit).toBe(true);
  expect(editorStore.getState().selectedPdfImageId).toBe("img-1");
  expect(editorStore.getState().selectedOcrWordIds).toEqual([]);
  editorStore.clearDocument();
});
