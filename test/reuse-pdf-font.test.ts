import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { PDFContext, PDFPage, PDFRef } from "pdf-lib";
import { expect, test } from "vitest";

import {
  reusableCodePoints,
  reuseEmbeddedPdfFont,
  singleCodePoint,
} from "@/lib/pdf/reuse-pdf-font";

const TO_UNICODE = `begincmap
7 beginbfchar
<0001> <0050>
<0002> <0072>
<0003> <006F>
<0004> <006D>
<0005> <0074>
<0006> <0073>
<0007> <0070>
endbfchar
endcmap
`;

const BASE_FONT = "ABCDEF+TestSans";

/** Font dict entries, typed by the dict pdf-lib's `context.stream` accepts. */
type FontFields = NonNullable<Parameters<PDFContext["stream"]>[1]>;

const text = (value: string) => ({
  baseFontName: BASE_FONT,
  fontSize: 10,
  height: 10,
  text: value,
});

const codePointString = (page: PDFPage, baseFontName = BASE_FONT): string =>
  String.fromCodePoint(
    ...reusableCodePoints(page, baseFontName).toSorted(
      (left, right) => left - right
    )
  );

const fontRef = (
  doc: PDFDocument,
  cmap: string,
  fields: FontFields
): PDFRef => {
  const toUnicode = doc.context.register(doc.context.flateStream(cmap));
  return doc.context.register(
    doc.context.obj({
      BaseFont: PDFName.of(BASE_FONT),
      ToUnicode: toUnicode,
      Type: PDFName.of("Font"),
      ...fields,
    })
  );
};

const type0Fields = (
  doc: PDFDocument,
  encoding = "Identity-H"
): FontFields => ({
  DescendantFonts: [
    doc.context.obj({
      DW: 500,
      Subtype: PDFName.of("CIDFontType2"),
      Type: PDFName.of("Font"),
      W: [1, [600, 500]],
    }),
  ],
  Encoding: PDFName.of(encoding),
  Subtype: PDFName.of("Type0"),
});

const fontPage = async (
  cmap: string,
  fields: (doc: PDFDocument) => FontFields
): Promise<{ doc: PDFDocument; page: PDFPage }> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.setFontDictionary(
    PDFName.of("F1"),
    fontRef(doc, cmap, fields(doc))
  );
  return { doc, page };
};

test("reuseEmbeddedPdfFont encodes Identity-H with CID widths", async () => {
  const { page } = await fontPage(TO_UNICODE, type0Fields);

  const reused = reuseEmbeddedPdfFont(page, text("Prompts"));
  expect(reused?.resourceName).toBe("F1");
  expect([...(reused?.encoded ?? [])]).toEqual([
    0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00, 0x07, 0x00, 0x05,
    0x00, 0x06,
  ]);
  // CID 1 = 600, CID 2 = 500 from /W; five more at /DW 500. Size 10.
  expect(reused?.width).toBeCloseTo(((600 + 500 + 5 * 500) / 1000) * 10);
  expect(reuseEmbeddedPdfFont(page, text("Promptx"))).toBeNull();
});

test("reusableCodePoints lists what the export lookup can encode", async () => {
  const { page } = await fontPage(TO_UNICODE, type0Fields);
  expect(codePointString(page)).toBe("Pmoprst");
  expect(reusableCodePoints(page, "ABCDEF+Missing")).toEqual([]);
});

test("simple fonts encode one byte and fall back to MissingWidth", async () => {
  const cmap = `beginbfchar
<41> <0041>
<42> <0042>
<43> <0043>
endbfchar`;
  const { page } = await fontPage(cmap, (doc) => ({
    FirstChar: 65,
    FontDescriptor: doc.context.obj({ MissingWidth: 250 }),
    Subtype: PDFName.of("TrueType"),
    Widths: [700, 650],
  }));

  const reused = reuseEmbeddedPdfFont(page, text("ABC"));
  expect([...(reused?.encoded ?? [])]).toEqual([0x41, 0x42, 0x43]);
  expect(reused?.width).toBeCloseTo(((700 + 650 + 250) / 1000) * 10);
});

test("simple fonts ignore ToUnicode sources wider than one byte", async () => {
  const cmap = `beginbfchar
<0041> <0041>
<42> <0042>
endbfchar`;
  const { page } = await fontPage(cmap, () => ({
    FirstChar: 65,
    Subtype: PDFName.of("Type1"),
    Widths: [700, 650],
  }));
  expect(codePointString(page)).toBe("B");
  expect(reuseEmbeddedPdfFont(page, text("A"))).toBeNull();
});

test("Type0 fonts other than Identity-H are not reused", async () => {
  const { page } = await fontPage(TO_UNICODE, (doc) =>
    type0Fields(doc, "UniGB-UCS2-H")
  );
  expect(reuseEmbeddedPdfFont(page, text("Prompt"))).toBeNull();
  expect(reusableCodePoints(page, BASE_FONT)).toEqual([]);
});

test("fonts without trustworthy widths are not reused", async () => {
  const { page } = await fontPage(TO_UNICODE, () => ({
    Encoding: PDFName.of("Identity-H"),
    Subtype: PDFName.of("Type0"),
  }));
  expect(reusableCodePoints(page, BASE_FONT)).toEqual([]);
});

test("ToUnicode parsing ignores line endings, names and ligatures", async () => {
  const cmap = [
    "4 beginbfchar",
    "<0001> /space <0002> <0041>",
    "<0003> <00660069>",
    "<0004> <D83DDE00>",
    "endbfchar",
    "2 beginbfrange",
    "<0010> <0012> <0061> <0020> <0021> [<0078> <0079>]",
    "endbfrange",
  ].join("\r");
  const { page } = await fontPage(cmap, type0Fields);

  expect(codePointString(page)).toBe("Aabcxy\u{1F600}");
  const reused = reuseEmbeddedPdfFont(page, text("Ab\u{1F600}y"));
  expect([...(reused?.encoded ?? [])]).toEqual([
    0x00, 0x02, 0x00, 0x11, 0x00, 0x04, 0x00, 0x21,
  ]);
});

test("singleCodePoint decodes one UTF-16BE character only", () => {
  expect(singleCodePoint("0041")).toBe(0x41);
  expect(singleCodePoint("D83DDE00")).toBe(0x1_f6_00);
  expect(singleCodePoint("00660069")).toBeNull();
  expect(singleCodePoint("D83D")).toBeNull();
  expect(singleCodePoint("041")).toBeNull();
});

test("ToUnicode streams decode with filters other than Flate", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const hex = [...new TextEncoder().encode(TO_UNICODE)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const toUnicode = doc.context.register(
    doc.context.stream(`${hex}>`, { Filter: "ASCIIHexDecode" })
  );
  const font = doc.context.register(
    doc.context.obj({
      BaseFont: PDFName.of(BASE_FONT),
      ToUnicode: toUnicode,
      Type: PDFName.of("Font"),
      ...type0Fields(doc),
    })
  );
  page.node.setFontDictionary(PDFName.of("F1"), font);
  expect(codePointString(page)).toBe("Pmoprst");
});

test("a font found in a form XObject is added to the page once", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = fontRef(doc, TO_UNICODE, type0Fields(doc));
  const form = doc.context.register(
    doc.context.stream("", {
      BBox: [0, 0, 612, 792],
      Resources: { Font: { F9: font } },
      Subtype: "Form",
      Type: "XObject",
    })
  );
  page.node.setXObject(PDFName.of("X1"), form);

  const first = reuseEmbeddedPdfFont(page, text("Prompt"));
  const second = reuseEmbeddedPdfFont(page, text("Prompts"));
  expect(first?.resourceName).toBeTruthy();
  expect(second?.resourceName).toBe(first?.resourceName);
  const pageFonts = page.node.normalizedEntries().Font;
  expect(pageFonts instanceof PDFDict && pageFonts.keys().length).toBe(1);
});
