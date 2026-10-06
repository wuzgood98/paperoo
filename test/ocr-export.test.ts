import { PDFDocument } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import type { EditorDocument } from "@/lib/editor/types";
import type { OcrTextObject as OcrWord } from "@/lib/ocr/types";
import { exportDocument } from "@/lib/pdf/export-pdf";

import { loadPdfJsDocument } from "./pdfjs-node";

const png1x1 = (): Uint8Array =>
  new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );

const LETTER = { height: 792, width: 612, x: 0, y: 0 };

const ocrWord = (overrides: Partial<OcrWord> = {}): OcrWord => ({
  baselineY: 100,
  confidence: 95,
  height: 18,
  id: "ocr-1",
  lineId: "line-1",
  pageId: "page-1",
  source: "ocr",
  text: "The quick brown fox jumps over the lazy dog twice.",
  type: "ocr-text",
  width: 360,
  x: 72,
  y: 82,
  ...overrides,
});

const scannedDocument = (): EditorDocument => ({
  pages: [
    {
      cropBox: LETTER,
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
          sourceId: "Im0",
          sourceIndex: 0,
          type: "pdf-image",
          width: 612,
          x: 0,
          y: 0,
        },
      ],
      pdfTextObjects: [],
      pdfVectorObjects: [],
      rotation: 0,
      skippedPdfAnnotationSubtypes: [],
      sourceIndex: 0,
      sourceRotate: 0,
      width: 612,
    },
  ],
});

const countImagePaints = async (bytes: Uint8Array): Promise<number> => {
  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const page = await document.getPage(1);
  const list = await page.getOperatorList();
  await task.destroy();
  return list.fnArray.filter((fn) => fn === OPS.paintImageXObject).length;
};

test("export appends invisible OCR text without flattening the scan", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const image = await source.embedPng(png1x1());
  page.drawImage(image, { height: 792, width: 612, x: 0, y: 0 });
  const bytes = await source.save();
  const originalPaints = await countImagePaints(bytes);
  expect(originalPaints).toBe(1);

  const word = ocrWord();
  const output = await exportDocument({
    assets: {},
    bytes,
    document: scannedDocument(),
    fontBytes: {},
    ocrWordsByPage: { "page-1": [word] },
  });

  const exportedPaints = await countImagePaints(output);
  expect(exportedPaints).toBe(1);

  const task = loadPdfJsDocument(output);
  const pdf = await task.promise;
  const pdfPage = await pdf.getPage(1);
  const content = await pdfPage.getTextContent();
  const list = await pdfPage.getOperatorList();
  await task.destroy();
  const extracted = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join("")
    .replaceAll(/\s+/gu, " ")
    .trim();
  expect(extracted).toContain("quick brown fox");
  expect(list.fnArray).toContain(OPS.setTextRenderingMode);
});

test("export skips suppressed OCR words", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const image = await source.embedPng(png1x1());
  page.drawImage(image, { height: 792, width: 612, x: 0, y: 0 });
  const bytes = await source.save();

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      ...scannedDocument(),
      pages: scannedDocument().pages.map((item) => ({
        ...item,
        suppressedOcrWordIds: ["ocr-1"],
      })),
    },
    fontBytes: {},
    ocrWordsByPage: { "page-1": [ocrWord()] },
  });

  const task = loadPdfJsDocument(output);
  const pdf = await task.promise;
  const pdfPage = await pdf.getPage(1);
  const content = await pdfPage.getTextContent();
  await task.destroy();
  const extracted = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join("");
  expect(extracted).not.toContain("quick");
});
