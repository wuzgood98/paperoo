import { expect, test } from "vitest";

import type {
  EditorPage,
  PdfImageObject,
  PdfTextObject,
} from "@/lib/editor/types";
import { classifyPageForOcr } from "@/lib/ocr/classify-page";

const LETTER = { height: 792, width: 612 };

const page = (overrides: Partial<EditorPage> = {}): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: LETTER.height,
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
  width: LETTER.width,
  ...overrides,
});

const text = (value: string): PdfTextObject => ({
  color: "#111827",
  dir: "ltr",
  fontName: "g_d0_f1",
  hasEOL: false,
  height: 12,
  id: "t1",
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
  width: 40,
  x: 72,
  y: 76,
});

const image = (width: number, height: number): PdfImageObject => ({
  deleted: false,
  height,
  id: "img-1",
  originalHeight: height,
  originalRotation: 0,
  originalWidth: width,
  originalX: 0,
  originalY: 0,
  pageId: "page-1",
  previewAssetId: null,
  replacementAssetId: null,
  rotation: 0,
  sourceId: "Im1",
  sourceIndex: 0,
  type: "pdf-image",
  width,
  x: 0,
  y: 0,
});

test("a paragraph of native text is native", () => {
  const body = "The quick brown fox jumps over the lazy dog twice.";
  expect(body.trim().length).toBeGreaterThanOrEqual(40);
  expect(classifyPageForOcr(page({ pdfTextObjects: [text(body)] }))).toBe(
    "native"
  );
});

test("a scanner banner plus a full-page image is scanned", () => {
  expect(
    classifyPageForOcr(
      page({
        pdfImageObjects: [image(612, 792)],
        pdfTextObjects: [text("Scanned by Xerox")],
      })
    )
  ).toBe("scanned");
});

test("a vector-only page with no usable text is plain", () => {
  expect(classifyPageForOcr(page())).toBe("plain");
});

test("a blank page is plain", () => {
  expect(classifyPageForOcr(page({ pdfTextObjects: [text("   \n")] }))).toBe(
    "plain"
  );
});

test("a small image with no text is plain", () => {
  expect(classifyPageForOcr(page({ pdfImageObjects: [image(80, 80)] }))).toBe(
    "plain"
  );
});

test("rotated displayed size uses page width and height for coverage", () => {
  expect(
    classifyPageForOcr(
      page({
        cropBox: { height: 612, width: 792, x: 0, y: 0 },
        height: 612,
        pdfImageObjects: [image(792, 612)],
        sourceRotate: 90,
        width: 792,
      })
    )
  ).toBe("scanned");
});
