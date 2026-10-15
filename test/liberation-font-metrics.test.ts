import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";

import {
  cssLineBoxBaselineRatio,
  LIBERATION_SANS_ASCENT_RATIO,
  LIBERATION_SANS_DESCENT_RATIO,
  LIBERATION_SANS_LINE_BOX_BASELINE_RATIO,
} from "@/lib/fonts/measure-text";

test("pdf-lib Liberation no-descender height is not the hhea ascent", async () => {
  const bytes = await readFile(
    path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
  );
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes);
  expect(font.heightAtSize(1000, { descender: false })).toBeCloseTo(683.1875);
  expect(font.heightAtSize(1000, { descender: false })).not.toBeCloseTo(905.27);
});

test("Liberation hhea ratios match the bundled font", async () => {
  const bytes = await readFile(
    path.join(process.cwd(), "public/fonts/LiberationSans-Regular.ttf")
  );
  const font = fontkit.create(bytes);
  expect(LIBERATION_SANS_ASCENT_RATIO).toBeCloseTo(
    font.ascent / font.unitsPerEm
  );
  expect(LIBERATION_SANS_DESCENT_RATIO).toBeCloseTo(
    -font.descent / font.unitsPerEm
  );
});

test("line-height 1 baseline sits above the ascent by half-leading", () => {
  expect(LIBERATION_SANS_LINE_BOX_BASELINE_RATIO).toBeCloseTo(0.847, 3);
  expect(LIBERATION_SANS_LINE_BOX_BASELINE_RATIO).toBeLessThan(
    LIBERATION_SANS_ASCENT_RATIO
  );
});

test("cssLineBoxBaselineRatio falls back without a DOM", () => {
  expect(
    cssLineBoxBaselineRatio({
      fontFamily: "sans",
      fontSize: 18,
      fontWeight: 400,
      italic: false,
    })
  ).toBe(LIBERATION_SANS_LINE_BOX_BASELINE_RATIO);
});
