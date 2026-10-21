import {
  layoutCombedText,
  layoutMultilineText,
  layoutSinglelineText,
  PDFDocument,
  StandardFonts,
  TextAlignment,
} from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import { beforeAll, expect, test } from "vitest";

import {
  autoCombFontSize,
  autoFormFontSize,
  formTextBounds,
} from "@/lib/editor/form-appearance";

let helvetica: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  helvetica = await doc.embedFont(StandardFonts.Helvetica);
});

const measure = (text: string, fontSize: number): number =>
  helvetica.widthOfTextAtSize(text, fontSize);

const box = (width: number, height: number) => ({
  height,
  width,
  x: 0,
  y: 0,
});

test("single-line auto size matches pdf-lib", () => {
  const cases = [
    ["Ada Lovelace Jr.", 200, 20],
    ["A much longer name that has to shrink to fit the box", 200, 20],
    ["Tiny", 60, 10],
    ["Tall box", 200, 40],
  ] as const;
  for (const [text, width, height] of cases) {
    const bounds = formTextBounds(box(width, height), 1, false);
    const expected = layoutSinglelineText(text, {
      alignment: TextAlignment.Left,
      bounds: { ...bounds, x: 0, y: 0 },
      font: helvetica,
    }).fontSize;
    expect(autoFormFontSize([text], bounds, measure, false)).toBe(expected);
  }
});

test("multiline auto size matches pdf-lib", () => {
  const text = "First line\nSecond line\nThird";
  const bounds = formTextBounds(box(200, 60), 1, false);
  const expected = layoutMultilineText(text, {
    alignment: TextAlignment.Left,
    bounds: { ...bounds, x: 0, y: 0 },
    font: helvetica,
  }).fontSize;
  expect(autoFormFontSize(text.split("\n"), bounds, measure, true)).toBe(
    expected
  );
});

test("comb auto size matches pdf-lib", () => {
  const bounds = formTextBounds(box(120, 20), 1, true);
  const expected = layoutCombedText("ABCDEF", {
    bounds: { ...bounds, x: 0, y: 0 },
    cellCount: 6,
    font: helvetica,
  }).fontSize;
  expect(autoCombFontSize("ABCDEF", bounds, 6, measure)).toBe(expected);
});

test("text bounds leave room for the border and padding", () => {
  expect(formTextBounds(box(200, 20), 1, false)).toEqual({
    height: 16,
    width: 196,
  });
  // Comb fields have no padding.
  expect(formTextBounds(box(120, 20), 1, true)).toEqual({
    height: 18,
    width: 118,
  });
});
