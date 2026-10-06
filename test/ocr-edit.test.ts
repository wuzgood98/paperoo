import { expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfImageObject } from "@/lib/editor/types";
import {
  MIN_OCR_EDIT_FONT_SIZE,
  MIN_OCR_EDIT_HEIGHT,
  MIN_OCR_EDIT_WIDTH,
  textObjectFromOcrWord,
} from "@/lib/ocr/edit";
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
  text: "Invoice",
  type: "ocr-text",
  width: 80,
  x: 72,
  y: 24,
});

test("editing an OCR word commits overlay text and undo restores the word", () => {
  editorStore.resetDocument([scannedPage()], "scan.pdf");
  const ocr = word();
  editorStore.commitOcrEdit(textObjectFromOcrWord(ocr), ocr.id);
  const [after] = editorStore.getState().document.pages;
  expect(after?.objects).toHaveLength(1);
  expect(after?.objects[0]).toMatchObject({
    content: "Invoice",
    ocrWordId: "ocr-1",
    type: "text",
  });
  expect(after?.suppressedOcrWordIds).toEqual(["ocr-1"]);
  editorStore.undo();
  const [undone] = editorStore.getState().document.pages;
  expect(undone?.objects).toEqual([]);
  expect(undone?.suppressedOcrWordIds ?? []).toEqual([]);
  editorStore.clearDocument();
});

test("OCR edit uses a minimum box size", () => {
  const object = textObjectFromOcrWord({
    ...word(),
    height: 0.2,
    width: 1,
  });
  expect(object.fontSize).toBe(MIN_OCR_EDIT_FONT_SIZE);
  expect(object.height).toBe(MIN_OCR_EDIT_HEIGHT);
  expect(object.width).toBe(MIN_OCR_EDIT_WIDTH);
});
