import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "vitest";

import type { EditorDocument, PdfTextObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";

import { loadPdfJsDocument } from "./pdfjs-node";

const pdfText = (overrides: Partial<PdfTextObject> = {}): PdfTextObject => ({
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 18,
  hasEOL: false,
  height: 18,
  id: "pdf-1",
  originalFontFamily: "sans",
  originalFontSize: 18,
  originalText: "Hello World",
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  text: "Hello World",
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
