import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { DEFAULT_PDF_TEXT_COLOR } from "@/lib/editor/types";
import {
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import {
  extractPdfTextFillPaints,
  toPdfTextColorOps,
  zipPdfTextItemColors,
} from "@/lib/pdf/extract-text-colors";
import type { PdfTextColorOps } from "@/lib/pdf/extract-text-colors";

import { loadPdfJsDocument } from "./pdfjs-node";

const FAKE_OPS = {
  nextLineSetSpacingShowText: 47,
  nextLineShowText: 46,
  restore: 11,
  save: 10,
  setFillCMYKColor: 61,
  setFillColor: 54,
  setFillColorN: 55,
  setFillGray: 57,
  setFillRGBColor: 59,
  setFillTransparent: 93,
  setTextRenderingMode: 38,
  showSpacedText: 45,
  showText: 44,
} satisfies PdfTextColorOps;

const channelToHex = (value: number): string =>
  Math.round(value * 255)
    .toString(16)
    .padStart(2, "0");

const rgbHex = (r: number, g: number, b: number): string =>
  `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;

test("extractPdfTextFillPaints samples RGB and gray fills at showText", () => {
  const paints = extractPdfTextFillPaints(
    {
      argsArray: [undefined, ["#ff0000"], [[]], [0.25], [[]]],
      fnArray: [
        FAKE_OPS.save,
        FAKE_OPS.setFillRGBColor,
        FAKE_OPS.showText,
        FAKE_OPS.setFillGray,
        FAKE_OPS.showText,
      ],
    },
    FAKE_OPS
  );

  expect(paints).toEqual(["#ff0000", "#404040"]);
});

test("extractPdfTextFillPaints defaults to black and restores fill after save", () => {
  const paints = extractPdfTextFillPaints(
    {
      argsArray: [undefined, undefined, ["#00ff00"], [[]], undefined, [[]]],
      fnArray: [
        FAKE_OPS.showText,
        FAKE_OPS.save,
        FAKE_OPS.setFillRGBColor,
        FAKE_OPS.showText,
        FAKE_OPS.restore,
        FAKE_OPS.showText,
      ],
    },
    FAKE_OPS
  );

  expect(paints).toEqual(["#000000", "#00ff00", "#000000"]);
});

test("extractPdfTextFillPaints returns null for unsupported fill and stroke-only Tr", () => {
  const paints = extractPdfTextFillPaints(
    {
      argsArray: [undefined, [[]], [1], ["#0000ff"], [[]]],
      fnArray: [
        FAKE_OPS.setFillTransparent,
        FAKE_OPS.showText,
        FAKE_OPS.setTextRenderingMode,
        FAKE_OPS.setFillRGBColor,
        FAKE_OPS.showText,
      ],
    },
    FAKE_OPS
  );

  expect(paints).toEqual([null, null]);
});

test("zipPdfTextItemColors aligns paints and fail-closes on length mismatch", () => {
  const items = [
    { str: "A", transform: [12, 0, 0, 12, 72, 700] },
    { str: " ", transform: [12, 0, 0, 12, 80, 700] },
    { str: "B", transform: [12, 0, 0, 12, 90, 700] },
    { hasEOL: true, str: "", transform: [12, 0, 0, 12, 100, 700] },
  ];

  const aligned = zipPdfTextItemColors(items, ["#ff0000", "#00ff00"]);
  expect(aligned.aligned).toBe(true);
  expect(aligned.colors).toEqual([
    "#ff0000",
    DEFAULT_PDF_TEXT_COLOR,
    "#00ff00",
    DEFAULT_PDF_TEXT_COLOR,
  ]);

  const mismatched = zipPdfTextItemColors(items, ["#ff0000"]);
  expect(mismatched.aligned).toBe(false);
  expect(
    mismatched.colors.every((color) => color === DEFAULT_PDF_TEXT_COLOR)
  ).toBe(true);
});

test("zipPdfTextItemColors recovers when counts differ but every paint is the same hex", () => {
  const items = [{ str: "HiThere", transform: [12, 0, 0, 12, 72, 700] }];
  const result = zipPdfTextItemColors(items, ["#3366cc", "#3366cc"]);
  expect(result.aligned).toBe(true);
  expect(result.colors).toEqual(["#3366cc"]);
});

test("extracts distinct RGB colors from multi-line pdf-lib text", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const red = rgb(1, 0, 0);
  const green = rgb(0, 0.5, 0);
  const blue = rgb(0, 0, 1);
  page.drawText("Red Line", { color: red, font, size: 18, x: 72, y: 700 });
  page.drawText("Green Line", { color: green, font, size: 18, x: 72, y: 650 });
  page.drawText("Blue Line", { color: blue, font, size: 18, x: 72, y: 600 });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const paints = extractPdfTextFillPaints(list, toPdfTextColorOps(OPS));
  const { aligned, colors } = zipPdfTextItemColors(
    extractable.items,
    paints,
    DEFAULT_PDF_TEXT_COLOR
  );
  const objects = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    {},
    colors
  );
  await task.destroy();

  expect(aligned).toBe(true);
  const redObject = objects.find((object) => object.text.includes("Red Line"));
  const greenObject = objects.find((object) =>
    object.text.includes("Green Line")
  );
  const blueObject = objects.find((object) =>
    object.text.includes("Blue Line")
  );
  expect(redObject?.originalColor).toBe(rgbHex(1, 0, 0));
  expect(greenObject?.originalColor).toBe(rgbHex(0, 0.5, 0));
  expect(blueObject?.originalColor).toBe(rgbHex(0, 0, 1));
});

test("fake-space gap still zips word colors after filtering space items", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Left", {
    color: rgb(1, 0, 0),
    font,
    size: 18,
    x: 72,
    y: 700,
  });
  page.drawText("Right", {
    color: rgb(0, 0, 1),
    font,
    size: 18,
    x: 300,
    y: 700,
  });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const paints = extractPdfTextFillPaints(list, toPdfTextColorOps(OPS));
  const { aligned, colors } = zipPdfTextItemColors(
    extractable.items,
    paints,
    DEFAULT_PDF_TEXT_COLOR
  );
  const objects = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    {},
    colors
  );
  await task.destroy();

  expect(aligned).toBe(true);
  expect(
    objects.find((object) => object.text.includes("Left"))?.originalColor
  ).toBe(rgbHex(1, 0, 0));
  expect(
    objects.find((object) => object.text.includes("Right"))?.originalColor
  ).toBe(rgbHex(0, 0, 1));
});

test("adjacent different-color merge fail-closes to DEFAULT_PDF_TEXT_COLOR", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Hi", {
    color: rgb(1, 0, 0),
    font,
    size: 18,
    x: 72,
    y: 700,
  });
  page.drawText("There", {
    color: rgb(0, 0, 1),
    font,
    size: 18,
    x: 72 + font.widthOfTextAtSize("Hi", 18),
    y: 700,
  });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const paints = extractPdfTextFillPaints(list, toPdfTextColorOps(OPS));
  const { aligned, colors } = zipPdfTextItemColors(
    extractable.items,
    paints,
    DEFAULT_PDF_TEXT_COLOR
  );
  const objects = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    {},
    colors
  );
  await task.destroy();

  expect(aligned).toBe(false);
  expect(paints.length).toBeGreaterThan(1);
  expect(
    objects.every((object) => object.originalColor === DEFAULT_PDF_TEXT_COLOR)
  ).toBe(true);
});

test("adjacent same-color merge recovers the shared hex", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const color = rgb(0.2, 0.4, 0.8);
  page.drawText("Hi", {
    color,
    font,
    size: 18,
    x: 72,
    y: 700,
  });
  page.drawText("There", {
    color,
    font,
    size: 18,
    x: 72 + font.widthOfTextAtSize("Hi", 18),
    y: 700,
  });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const paints = extractPdfTextFillPaints(list, toPdfTextColorOps(OPS));
  const { aligned, colors } = zipPdfTextItemColors(
    extractable.items,
    paints,
    DEFAULT_PDF_TEXT_COLOR
  );
  const objects = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    {},
    colors
  );
  await task.destroy();

  expect(aligned).toBe(true);
  const merged = objects.find((object) => object.text.includes("Hi"));
  expect(merged?.originalColor).toBe(rgbHex(0.2, 0.4, 0.8));
});

test("default black body text extracts as #000000 when aligned", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Black Body", { font, size: 18, x: 72, y: 700 });
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const paints = extractPdfTextFillPaints(list, toPdfTextColorOps(OPS));
  const { aligned, colors } = zipPdfTextItemColors(
    extractable.items,
    paints,
    DEFAULT_PDF_TEXT_COLOR
  );
  const objects = extractPdfTextObjects(
    extractable,
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    {},
    colors
  );
  await task.destroy();

  expect(aligned).toBe(true);
  expect(
    objects.find((object) => object.text.includes("Black Body"))?.originalColor
  ).toBe("#000000");
});

test("extractPdfTextObjects uses itemColors when provided", () => {
  const objects = extractPdfTextObjects(
    {
      items: [
        {
          height: 12,
          str: "Tinted",
          transform: [12, 0, 0, 12, 72, 700],
          width: 40,
        },
      ],
      styles: {},
    },
    {
      cropBox: { height: 792, width: 612, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    {},
    ["#abcdef"]
  );

  expect(objects[0]?.color).toBe("#abcdef");
  expect(objects[0]?.originalColor).toBe("#abcdef");
});
