import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "vitest";

import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  resolvePdfFont,
  resolvePdfFontItalic,
  resolvePdfFontWeight,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";

import { loadPdfJsDocument } from "./pdfjs-node";

test("resolvePdfFont maps PDF.js generic families", () => {
  expect(resolvePdfFont("sans-serif")).toBe("sans");
  expect(resolvePdfFont("serif")).toBe("serif");
  expect(resolvePdfFont("monospace")).toBe("mono");
  expect(resolvePdfFont()).toBe("sans");
});

test("resolvePdfFontWeight and resolvePdfFontItalic follow face-name heuristics", () => {
  expect(resolvePdfFontWeight("Helvetica")).toBe(400);
  expect(resolvePdfFontWeight("Helvetica-Bold")).toBe(700);
  expect(resolvePdfFontWeight("ArialBlack")).toBe(700);
  expect(resolvePdfFontWeight("Helvetica", true)).toBe(700);
  expect(resolvePdfFontItalic("Helvetica")).toBe(false);
  expect(resolvePdfFontItalic("Helvetica-Oblique")).toBe(true);
  expect(resolvePdfFontItalic("Times-Italic")).toBe(true);
  expect(resolvePdfFontItalic("Helvetica", true)).toBe(true);
});

test("extractPdfTextObjects skips items without a transform", () => {
  const objects = extractPdfTextObjects(
    {
      items: [
        { str: "XFA only" },
        {
          height: 12,
          str: "Hello",
          transform: [12, 0, 0, 12, 72, 700],
          width: 30,
        },
      ],
      styles: {},
    },
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    }
  );
  expect(objects).toHaveLength(1);
  expect(objects[0]?.text).toBe("Hello");
  expect(objects[0]?.originalText).toBe("Hello");
  expect(objects[0]?.fontFamily).toBe("sans");
  expect(objects[0]?.fontWeight).toBe(400);
  expect(objects[0]?.italic).toBe(false);
});

test("extractPdfTextObjects applies fontFaces weight and italic", () => {
  const objects = extractPdfTextObjects(
    {
      items: [
        {
          fontName: "g_d0_f1",
          height: 12,
          str: "Bold",
          transform: [12, 0, 0, 12, 72, 700],
          width: 30,
        },
      ],
      styles: { g_d0_f1: { fontFamily: "sans-serif" } },
    },
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    { g_d0_f1: { name: "Helvetica-Bold" } }
  );
  expect(objects[0]?.fontWeight).toBe(700);
  expect(objects[0]?.italic).toBe(false);
});

test("extracts Hello World at the top, middle, and bottom of a page", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { font, size: 24, x: 72, y: 740 });
  page.drawText("Hello World", { font, size: 18, x: 72, y: 396 });
  page.drawText("Hello World", { font, size: 12, x: 72, y: 72 });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const content = await pdfPage.getTextContent();
  const objects = extractPdfTextObjects(toExtractableTextContent(content), {
    cropBox: {
      height: 792,
      width: 612,
      x: 0,
      y: 0,
    },
    id: "page-1",
    sourceRotate: 0,
  });

  const lines = objects.filter((object) => object.text.includes("Hello World"));
  expect(lines.length).toBeGreaterThanOrEqual(3);
  const tops = lines
    .map((object) => object.y)
    .toSorted((left, right) => left - right);
  expect(tops[0]).toBeLessThan(tops[1] ?? Number.POSITIVE_INFINITY);
  expect(tops[1]).toBeLessThan(tops[2] ?? Number.POSITIVE_INFINITY);

  await task.destroy();
});

test("extracts fontWeight 700 from HelveticaBold via commonObjs", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Regular Run", { font: regular, size: 18, x: 72, y: 700 });
  page.drawText("Bold Run", { font: bold, size: 18, x: 72, y: 650 });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
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

  const regularObject = objects.find((object) =>
    object.text.includes("Regular Run")
  );
  const boldObject = objects.find((object) => object.text.includes("Bold Run"));
  expect(regularObject?.fontWeight).toBe(400);
  expect(boldObject?.fontWeight).toBe(700);

  await task.destroy();
});
