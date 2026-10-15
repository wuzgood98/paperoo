import { expect, test } from "vitest";

import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import {
  collectEmbeddedFontGlyphs,
  mergeEmbeddedFontGlyphs,
} from "@/lib/pdf/embedded-font";

const run = (
  id: string,
  fontName: string,
  originalText: string
): PdfTextObject => ({
  color: "#000000",
  dir: "ltr",
  embeddedFontGlyphs: "",
  fontName,
  hasEOL: false,
  height: 12,
  id,
  originalColor: "#000000",
  originalStrokeColor: "#000000",
  originalStrokeWidth: 1,
  originalText,
  originalTextRenderingMode: 0,
  pageId: "page",
  rotation: 0,
  sourceIndex: 0,
  strokeColor: "#000000",
  strokeWidth: 1,
  text: originalText,
  textRenderingMode: 0,
  transform: [12, 0, 0, 12, 72, 700],
  type: "pdf-text",
  width: 40,
  x: 72,
  y: 80,
});

const page = (id: string, runs: PdfTextObject[]): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id,
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: runs,
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

test("collectEmbeddedFontGlyphs skips items without a font or text", () => {
  const glyphs = collectEmbeddedFontGlyphs([
    { fontName: "f1", str: "ba" },
    { str: "zz" },
    { fontName: "f2" },
    { fontName: "f1", str: "ab" },
  ]);
  expect([...glyphs]).toEqual([["f1", "ab"]]);
});

test("mergeEmbeddedFontGlyphs widens a font's glyphs across pages", () => {
  const first = page("p1", [run("a", "f1", "Pro"), run("b", "f2", "xy")]);
  const second = page("p2", [run("c", "f1", "mpt")]);
  const merged = mergeEmbeddedFontGlyphs([first, second]);

  const glyphsOf = (id: string): string | undefined =>
    merged
      .flatMap((item) => item.pdfTextObjects)
      .find((object) => object.id === id)?.embeddedFontGlyphs;
  expect(glyphsOf("a")).toBe("Pmoprt");
  expect(glyphsOf("c")).toBe("Pmoprt");
  expect(glyphsOf("b")).toBe("xy");

  // Already merged: nothing changes, so pages keep their identity.
  const again = mergeEmbeddedFontGlyphs(merged);
  expect(again[0]).toBe(merged[0]);
  expect(again[1]).toBe(merged[1]);
});
