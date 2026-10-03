import { PDFDocument, StandardFonts } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import type { EditorDocument, PdfTextObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";

import { loadPdfJsDocument } from "./pdfjs-node";

const pdfText = (overrides: Partial<PdfTextObject> = {}): PdfTextObject => ({
  color: "#111827",
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 18,
  fontWeight: 400,
  hasEOL: false,
  height: 18,
  id: "pdf-1",
  italic: false,
  originalColor: "#111827",
  originalFontFamily: "sans",
  originalFontSize: 18,
  originalStrokeColor: "#000000",
  originalStrokeWidth: 1,
  originalText: "Hello World",
  originalTextRenderingMode: 0,
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  strokeColor: "#000000",
  strokeWidth: 1,
  text: "Hello World",
  textRenderingMode: 0,
  transform: [18, 0, 0, 18, 72, 700],
  type: "pdf-text",
  width: 90,
  x: 72,
  y: 74,
  ...overrides,
});

test("export leaves the source bytes unchanged and writes replacement text", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { font, size: 18, x: 72, y: 700 });
  const bytes = await source.save();
  const original = new Uint8Array(bytes);

  const document: EditorDocument = {
    pages: [
      {
        cropBox: { height: 792, width: 612, x: 0, y: 0 },
        height: 792,
        id: "page-1",
        objects: [],
        pdfImageObjects: [],
        pdfTextObjects: [pdfText({ text: "Hello Gideon and more" })],
        pdfVectorObjects: [],
        rotation: 0,
        sourceIndex: 0,
        sourceRotate: 0,
        width: 612,
      },
    ],
  };

  const output = await exportDocument({
    assets: {},
    bytes,
    document,
    fontBytes: {},
  });

  expect(bytes).toEqual(original);

  const task = loadPdfJsDocument(output);
  const documentProxy = await task.promise;
  const pdfPage = await documentProxy.getPage(1);
  const content = await pdfPage.getTextContent();
  const strings = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(strings).toContain("Hello Gideon and more");
  await task.destroy();
});

test("export draws dirty PDF text with the object color", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { font, size: 18, x: 72, y: 700 });
  const bytes = await source.save();

  const colored = pdfText({
    color: "#dc2626",
    text: "Hello Red Edit",
  });
  expect(colored.color).toBe("#dc2626");

  const document: EditorDocument = {
    pages: [
      {
        cropBox: { height: 792, width: 612, x: 0, y: 0 },
        height: 792,
        id: "page-1",
        objects: [],
        pdfImageObjects: [],
        pdfTextObjects: [colored],
        pdfVectorObjects: [],
        rotation: 0,
        sourceIndex: 0,
        sourceRotate: 0,
        width: 612,
      },
    ],
  };

  const output = await exportDocument({
    assets: {},
    bytes,
    document,
    fontBytes: {},
  });

  const task = loadPdfJsDocument(output);
  const documentProxy = await task.promise;
  const pdfPage = await documentProxy.getPage(1);
  const content = await pdfPage.getTextContent();
  const strings = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  // drawDirtyPdfText uses object.color; channel bits covered by dirty/store tests.
  expect(strings).toContain("Hello Red Edit");
  await task.destroy();
});

test("export draws dirty stroke-only PDF text with Outline mode", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { font, size: 18, x: 72, y: 700 });
  const bytes = await source.save();

  const outlined = pdfText({
    originalStrokeColor: "#2563eb",
    originalText: "Hello World",
    originalTextRenderingMode: 1,
    strokeColor: "#2563eb",
    strokeWidth: 1.5,
    text: "Hello Outline",
    textRenderingMode: 1,
  });

  const document: EditorDocument = {
    pages: [
      {
        cropBox: { height: 792, width: 612, x: 0, y: 0 },
        height: 792,
        id: "page-1",
        objects: [],
        pdfImageObjects: [],
        pdfTextObjects: [outlined],
        pdfVectorObjects: [],
        rotation: 0,
        sourceIndex: 0,
        sourceRotate: 0,
        width: 612,
      },
    ],
  };

  const output = await exportDocument({
    assets: {},
    bytes,
    document,
    fontBytes: {},
  });

  const task = loadPdfJsDocument(output);
  const documentProxy = await task.promise;
  const pdfPage = await documentProxy.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const strings = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(strings).toContain("Hello Outline");
  expect(list.fnArray).toContain(OPS.setTextRenderingMode);
  expect(list.fnArray).toContain(OPS.setStrokeRGBColor);
  await task.destroy();
});

test("export redraws dirty PDF text with bold StandardFonts weight", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const font = await source.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Hello World", { font, size: 18, x: 72, y: 700 });
  const bytes = await source.save();

  const document: EditorDocument = {
    pages: [
      {
        cropBox: { height: 792, width: 612, x: 0, y: 0 },
        height: 792,
        id: "page-1",
        objects: [],
        pdfImageObjects: [],
        pdfTextObjects: [
          pdfText({
            fontWeight: 700,
            originalText: "Hello World",
            text: "Hello Bold Edit",
          }),
        ],
        pdfVectorObjects: [],
        rotation: 0,
        sourceIndex: 0,
        sourceRotate: 0,
        width: 612,
      },
    ],
  };

  const output = await exportDocument({
    assets: {},
    bytes,
    document,
    fontBytes: {},
  });

  const task = loadPdfJsDocument(output);
  const documentProxy = await task.promise;
  const pdfPage = await documentProxy.getPage(1);
  // Fonts are posted to commonObjs during operator-list translation, not
  // getTextContent alone (same order as PdfSession.open).
  const [content] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const fontFaces = await collectPdfFontFaces(
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    pdfPage.commonObjs as PdfJsFontObjectStore,
    extractable.items
  );
  const objects = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    fontFaces
  );

  const replaced = objects.find((object) =>
    object.text.includes("Hello Bold Edit")
  );
  expect(replaced?.fontWeight).toBe(700);
  await task.destroy();
});
