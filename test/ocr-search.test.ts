import { expect, test } from "vitest";

import { createTextObject } from "@/lib/editor/object-utils";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { classifyPageForOcr } from "@/lib/ocr/classify-page";
import { searchDocumentText } from "@/lib/ocr/search";
import type { OcrTextObject } from "@/lib/ocr/types";

const page = (overrides: Partial<EditorPage> = {}): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
  ...overrides,
});

const nativeText = (value: string, id = "t1"): PdfTextObject => ({
  color: "#111827",
  dir: "ltr",
  fontName: "g_d0_f1",
  hasEOL: false,
  height: 12,
  id,
  originalColor: "#111827",
  originalStrokeColor: "#000000",
  originalStrokeWidth: 1,
  originalText: value,
  originalTextRenderingMode: 0,
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  strokeColor: "#000000",
  strokeWidth: 1,
  text: value,
  textRenderingMode: 0,
  transform: [12, 0, 0, 12, 72, 700],
  type: "pdf-text",
  width: 80,
  x: 72,
  y: 76,
});

const ocrWord = (text: string, id = "o1"): OcrTextObject => ({
  baselineY: 90,
  confidence: 90,
  height: 16,
  id,
  lineId: "line-1",
  pageId: "page-2",
  source: "ocr",
  text,
  type: "ocr-text",
  width: 40,
  x: 10,
  y: 80,
});

test("search finds native text on a native page", () => {
  const native = page({
    id: "page-1",
    pdfTextObjects: [
      nativeText("The quick brown fox jumps over the lazy dog twice."),
    ],
  });
  expect(classifyPageForOcr(native)).toBe("native");
  const hits = searchDocumentText(
    [native],
    { "page-1": [ocrWord("fox")] },
    "fox"
  );
  expect(hits).toHaveLength(1);
  expect(hits[0]?.source).toBe("native");
  expect(hits[0]?.pageId).toBe("page-1");
  expect(hits[0]?.objectId).toBe("t1");
});

test("search finds OCR words on a scanned page", () => {
  const scanned = page({
    id: "page-2",
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
        pageId: "page-2",
        previewAssetId: null,
        replacementAssetId: null,
        rotation: 0,
        sourceId: "Im1",
        sourceIndex: 0,
        type: "pdf-image",
        width: 612,
        x: 0,
        y: 0,
      },
    ],
  });
  expect(classifyPageForOcr(scanned)).toBe("scanned");
  const hits = searchDocumentText(
    [scanned],
    { "page-2": [ocrWord("Invoice")] },
    "invoice"
  );
  expect(hits).toHaveLength(1);
  expect(hits[0]?.source).toBe("ocr");
  expect(hits[0]?.objectId).toBe("o1");
});

test("search skips suppressed OCR words", () => {
  const scanned = page({
    id: "page-2",
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
        pageId: "page-2",
        previewAssetId: null,
        replacementAssetId: null,
        rotation: 0,
        sourceId: "Im1",
        sourceIndex: 0,
        type: "pdf-image",
        width: 612,
        x: 0,
        y: 0,
      },
    ],
    suppressedOcrWordIds: ["o1"],
  });
  const hits = searchDocumentText(
    [scanned],
    { "page-2": [ocrWord("Invoice")] },
    "invoice"
  );
  expect(hits).toEqual([]);
});

test("search does not return OCR hits on a native page", () => {
  const native = page({
    pdfTextObjects: [
      nativeText("The quick brown fox jumps over the lazy dog twice."),
    ],
  });
  const hits = searchDocumentText(
    [native],
    { "page-1": [ocrWord("fox", "dup")] },
    "fox"
  );
  expect(hits.map((hit) => hit.source)).toEqual(["native"]);
});

test("search finds overlay text that replaced an OCR word", () => {
  const overlay = createTextObject(
    { x: 10, y: 80 },
    {
      content: "Receipt",
      height: 16,
      ocrWordId: "o1",
      width: 40,
    }
  );
  const scanned = page({
    id: "page-2",
    objects: [overlay],
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
        pageId: "page-2",
        previewAssetId: null,
        replacementAssetId: null,
        rotation: 0,
        sourceId: "Im1",
        sourceIndex: 0,
        type: "pdf-image",
        width: 612,
        x: 0,
        y: 0,
      },
    ],
    suppressedOcrWordIds: ["o1"],
  });
  const hits = searchDocumentText(
    [scanned],
    { "page-2": [ocrWord("Invoice")] },
    "receipt"
  );
  expect(hits).toHaveLength(1);
  expect(hits[0]?.source).toBe("overlay");
  expect(hits[0]?.objectId).toBe(overlay.id);
  expect(hits[0]?.text).toBe("Receipt");
});
