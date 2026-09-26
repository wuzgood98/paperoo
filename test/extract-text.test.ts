import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "vitest";

import {
  extractPdfTextObjects,
  resolvePdfFont,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";

import { loadPdfJsDocument } from "./pdfjs-node";

test("resolvePdfFont maps PDF.js generic families", () => {
  expect(resolvePdfFont("sans-serif")).toBe("sans");
  expect(resolvePdfFont("serif")).toBe("serif");
  expect(resolvePdfFont("monospace")).toBe("mono");
  expect(resolvePdfFont()).toBe("sans");
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
