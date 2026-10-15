import { expect, test } from "vitest";

import { measurePdfTextCoverRects } from "@/lib/editor/object-utils";
import type { GlyphInkMeasurer } from "@/lib/editor/object-utils";
import type { EditorPage, PdfTextObject, Rect } from "@/lib/editor/types";
import type { PdfTextGlyphInk } from "@/lib/fonts/measure-text";

const FONT_SIZE = 40;
const ADVANCE_EM = 0.5;
const CROP_HEIGHT = 792;

/** Ascent / descent per character, in em. The "i" reaches its dot. */
interface GlyphEm {
  ascent: number;
  descent: number;
}

const GLYPH_EM = new Map<string, GlyphEm>([
  ["P", { ascent: 0.7, descent: 0 }],
  ["g", { ascent: 0.5, descent: 0.25 }],
  ["i", { ascent: 0.8, descent: 0 }],
  ["p", { ascent: 0.5, descent: 0.25 }],
  ["t", { ascent: 0.65, descent: 0 }],
]);
const X_HEIGHT: GlyphEm = { ascent: 0.5, descent: 0 };

const stubGlyphInk = (text: string, fontSize: number): PdfTextGlyphInk[] =>
  [...text].map((char, index) => {
    const em = GLYPH_EM.get(char) ?? X_HEIGHT;
    return {
      ascent: em.ascent * fontSize,
      descent: em.descent * fontSize,
      left: index * ADVANCE_EM * fontSize,
      width: ADVANCE_EM * fontSize,
    };
  });

/** Stands in for the browser canvas, recording which strings were measured. */
interface RecordingMeasurer {
  measureInk: GlyphInkMeasurer;
  /** Every string measured, in call order. */
  measured: string[];
}

const recordingMeasurer = (): RecordingMeasurer => {
  const measured: string[] = [];
  return {
    measureInk: (text, font) => {
      measured.push(text);
      return stubGlyphInk(text, font.fontSize);
    },
    measured,
  };
};

const run = (id: string, text: string, userBaseline: number): PdfTextObject => {
  const displayedBaseline = CROP_HEIGHT - userBaseline;
  return {
    ascentRatio: 0.8,
    color: "#000000",
    descentRatio: 0.25,
    dir: "ltr",
    fontFamily: "sans",
    fontName: "g_d0_f1",
    fontSize: FONT_SIZE,
    hasEOL: false,
    height: FONT_SIZE,
    id,
    originalColor: "#000000",
    originalFontFamily: "sans",
    originalFontSize: FONT_SIZE,
    originalStrokeColor: "#000000",
    originalStrokeWidth: 1,
    originalText: text,
    originalTextRenderingMode: 0,
    pageId: "page-1",
    rotation: 0,
    sourceIndex: 0,
    strokeColor: "#000000",
    strokeWidth: 1,
    text,
    textRenderingMode: 0,
    transform: [FONT_SIZE, 0, 0, FONT_SIZE, 72, userBaseline],
    type: "pdf-text",
    width: text.length * ADVANCE_EM * FONT_SIZE,
    x: 72,
    y: displayedBaseline - FONT_SIZE * 0.8,
  };
};

const page = (runs: PdfTextObject[]): EditorPage => ({
  cropBox: { height: CROP_HEIGHT, width: 612, x: 0, y: 0 },
  height: CROP_HEIGHT,
  id: "page-1",
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

/** Displayed-space glyph rects, as the cover helpers build them. */
const glyphRects = (object: PdfTextObject): Rect[] => {
  const baseline = CROP_HEIGHT - object.transform[5];
  return stubGlyphInk(object.originalText, FONT_SIZE).map((glyph) => ({
    height: glyph.ascent + glyph.descent,
    width: glyph.width,
    x: object.x + glyph.left,
    y: baseline - glyph.ascent,
  }));
};

const overlaps = (left: Rect, right: Rect): boolean =>
  left.x < right.x + right.width &&
  right.x < left.x + left.width &&
  left.y < right.y + right.height &&
  right.y < left.y + left.height;

const contains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x &&
  x <= rect.x + rect.width &&
  y >= rect.y &&
  y <= rect.y + rect.height;

test("stacked runs at 1.0 em: the cover keeps descenders and skips the i dots", () => {
  const upper = run("upper", "Prompt", 400);
  const lower = run("lower", "Printing", 400 - FONT_SIZE);
  const editorPage = page([upper, lower]);

  const { measureInk } = recordingMeasurer();
  const covers = measurePdfTextCoverRects(
    upper,
    editorPage,
    [upper, lower],
    measureInk
  );
  const lowerInk = glyphRects(lower);

  for (const cover of covers) {
    for (const glyph of lowerInk) {
      expect(overlaps(cover, glyph)).toBe(false);
    }
  }

  // Every point of the upper "p" descender that is not lower ink stays covered.
  const descender = glyphRects(upper).find(
    (_, index) => upper.originalText[index] === "p"
  );
  expect(descender).toBeDefined();
  if (!descender) {
    return;
  }
  const step = 0.5;
  for (let { y } = descender; y <= descender.y + descender.height; y += step) {
    for (
      let x = descender.x + step;
      x < descender.x + descender.width;
      x += step
    ) {
      if (lowerInk.some((glyph) => contains(glyph, x, y))) {
        continue;
      }
      expect(covers.some((cover) => contains(cover, x, y))).toBe(true);
    }
  }

  // Only the two i dots reach up; the cover splits around them instead of
  // shrinking above the whole lower line.
  expect(covers.length).toBeGreaterThan(1);
  const lowestBottom = Math.max(
    ...covers.map((cover) => cover.y + cover.height)
  );
  expect(lowestBottom).toBeGreaterThan(descender.y + descender.height);
});

test("neighbours out of reach skip the per-glyph measuring", () => {
  const upper = run("upper", "Prompt", 400);
  const far = run("far", "Footer", 60);
  const { measureInk, measured } = recordingMeasurer();

  measurePdfTextCoverRects(upper, page([upper, far]), [upper, far], measureInk);

  expect(measured).toContain("Prompt");
  expect(measured).not.toContain("Footer");
});
