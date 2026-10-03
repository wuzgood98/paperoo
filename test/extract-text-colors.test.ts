import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  beginText,
  cmyk,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rotateAndSkewTextRadiansAndTranslate,
  setFontAndSize,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  showText,
  toRadians,
} from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { DEFAULT_PDF_TEXT_COLOR } from "@/lib/editor/types";
import {
  colorsToItemPaints,
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import {
  extractPdfTextFillPaints,
  extractPdfTextPaints,
  toPdfTextColorOps,
  zipPdfTextItemColors,
  zipPdfTextItemPaints,
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
  setLineWidth: 2,
  setStrokeCMYKColor: 60,
  setStrokeColor: 52,
  setStrokeColorN: 53,
  setStrokeGray: 56,
  setStrokeRGBColor: 58,
  setStrokeTransparent: 92,
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

test("extractPdfTextPaints samples RGB and gray fills at showText", () => {
  const paints = extractPdfTextPaints(
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

  expect(paints.map((paint) => paint?.color)).toEqual(["#ff0000", "#404040"]);
  expect(paints.every((paint) => paint?.textRenderingMode === 0)).toBe(true);
});

test("extractPdfTextPaints defaults to black and restores fill after save", () => {
  const paints = extractPdfTextPaints(
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

  expect(paints.map((paint) => paint?.color)).toEqual([
    "#000000",
    "#00ff00",
    "#000000",
  ]);
});

test("extractPdfTextPaints returns null for unsupported fill and ColorN", () => {
  const paints = extractPdfTextPaints(
    {
      argsArray: [undefined, [[]], undefined, [[]]],
      fnArray: [
        FAKE_OPS.setFillTransparent,
        FAKE_OPS.showText,
        FAKE_OPS.setFillColorN,
        FAKE_OPS.showText,
      ],
    },
    FAKE_OPS
  );

  expect(paints).toEqual([null, null]);
});

test("extractPdfTextPaints samples stroke-only and fill+stroke modes", () => {
  const paints = extractPdfTextPaints(
    {
      argsArray: [
        [1],
        ["#ff0000"],
        [2],
        [[]],
        [2],
        ["#00ff00"],
        ["#0000ff"],
        [1.5],
        [[]],
      ],
      fnArray: [
        FAKE_OPS.setTextRenderingMode,
        FAKE_OPS.setStrokeRGBColor,
        FAKE_OPS.setLineWidth,
        FAKE_OPS.showText,
        FAKE_OPS.setTextRenderingMode,
        FAKE_OPS.setFillRGBColor,
        FAKE_OPS.setStrokeRGBColor,
        FAKE_OPS.setLineWidth,
        FAKE_OPS.showText,
      ],
    },
    FAKE_OPS
  );

  expect(paints).toEqual([
    {
      color: null,
      strokeColor: "#ff0000",
      strokeWidth: 2,
      textRenderingMode: 1,
    },
    {
      color: "#00ff00",
      strokeColor: "#0000ff",
      strokeWidth: 1.5,
      textRenderingMode: 2,
    },
  ]);
});

test("extractPdfTextPaints nulls stroke-only when stroke ColorN is set", () => {
  const paints = extractPdfTextPaints(
    {
      argsArray: [[1], undefined, [[]]],
      fnArray: [
        FAKE_OPS.setTextRenderingMode,
        FAKE_OPS.setStrokeColorN,
        FAKE_OPS.showText,
      ],
    },
    FAKE_OPS
  );

  expect(paints).toEqual([null]);
});

test("extractPdfTextFillPaints exposes fill channel only", () => {
  const paints = extractPdfTextFillPaints(
    {
      argsArray: [["#abcdef"], [[]]],
      fnArray: [FAKE_OPS.setFillRGBColor, FAKE_OPS.showText],
    },
    FAKE_OPS
  );
  expect(paints).toEqual(["#abcdef"]);
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

test("zipPdfTextItemPaints recovers stroke-only same ink merge", () => {
  const items = [{ str: "HiThere", transform: [12, 0, 0, 12, 72, 700] }];
  const strokePaint = {
    color: null,
    strokeColor: "#3366cc",
    strokeWidth: 1,
    textRenderingMode: 1,
  };
  const result = zipPdfTextItemPaints(items, [strokePaint, strokePaint]);
  expect(result.aligned).toBe(true);
  expect(result.paints[0]).toEqual({
    color: DEFAULT_PDF_TEXT_COLOR,
    strokeColor: "#3366cc",
    strokeWidth: 1,
    textRenderingMode: 1,
  });
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
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
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
  expect(redObject?.textRenderingMode).toBe(0);
});

test("CMYK fill text extracts as RGB hex via PDF.js rewrite", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Cyan Ink", {
    color: cmyk(1, 0, 0, 0),
    font,
    size: 18,
    x: 72,
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
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
  );
  await task.destroy();

  expect(aligned).toBe(true);
  const cyan = objects.find((object) => object.text.includes("Cyan Ink"));
  expect(cyan?.originalColor).toMatch(/^#[0-9a-f]{6}$/u);
  expect(cyan?.originalColor).not.toBe(DEFAULT_PDF_TEXT_COLOR);
  // DeviceCMYK(1,0,0,0) is near cyan — green and blue channels high, red low.
  const hex = cyan?.originalColor ?? "";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  expect(r).toBeLessThan(g);
  expect(r).toBeLessThan(b);
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
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
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
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
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
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
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
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
  );
  await task.destroy();

  expect(aligned).toBe(true);
  expect(
    objects.find((object) => object.text.includes("Black Body"))?.originalColor
  ).toBe("#000000");
});

test("stroke-only Tr=1 text extracts stroke color and mode", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.setFont(font);
  interface PageFontKey {
    fontKey: { encodedName: string };
  }
  // SAFETY: pdf-lib exposes fontKey on PDFPage after setFont (runtime field).
  const fontKey = (page as PageFontKey).fontKey.encodedName.slice(1);
  const zero = degrees(0);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Outline),
    setStrokingColor(rgb(1, 0, 0)),
    setLineWidth(1.25),
    setFontAndSize(fontKey, 18),
    rotateAndSkewTextRadiansAndTranslate(
      toRadians(zero),
      toRadians(zero),
      toRadians(zero),
      72,
      700
    ),
    showText(font.encodeText("Outline")),
    endText(),
    popGraphicsState()
  );
  const bytes = await pdf.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const [content, list] = await Promise.all([
    pdfPage.getTextContent(),
    pdfPage.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const paints = extractPdfTextPaints(list, toPdfTextColorOps(OPS));
  const { aligned, paints: itemPaints } = zipPdfTextItemPaints(
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
    itemPaints
  );
  await task.destroy();

  expect(aligned).toBe(true);
  const outline = objects.find((object) => object.text.includes("Outline"));
  expect(outline?.textRenderingMode).toBe(1);
  expect(outline?.originalStrokeColor).toBe("#ff0000");
  expect(outline?.originalStrokeWidth).toBe(1.25);
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
    colorsToItemPaints(["#abcdef"])
  );

  expect(objects[0]?.color).toBe("#abcdef");
  expect(objects[0]?.originalColor).toBe("#abcdef");
  expect(objects[0]?.textRenderingMode).toBe(0);
  expect(objects[0]?.strokeColor).toBe("#000000");
});

test("extractPdfTextObjects uses item paint records when provided", () => {
  const objects = extractPdfTextObjects(
    {
      items: [
        {
          height: 12,
          str: "Outlined",
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
    [
      {
        color: DEFAULT_PDF_TEXT_COLOR,
        strokeColor: "#ff0000",
        strokeWidth: 2,
        textRenderingMode: 1,
      },
    ]
  );

  expect(objects[0]?.textRenderingMode).toBe(1);
  expect(objects[0]?.strokeColor).toBe("#ff0000");
  expect(objects[0]?.strokeWidth).toBe(2);
  expect(objects[0]?.originalStrokeColor).toBe("#ff0000");
});
