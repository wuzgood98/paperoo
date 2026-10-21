import { expect, test } from "vitest";

import { pdfTextBaselineDisplayed } from "@/lib/editor/coordinates";
import {
  fittedPdfTextBox,
  hitTestPdfText,
  pdfTextStripTurn,
  pdfTextUnturnedBox,
} from "@/lib/editor/object-utils";
import type { PdfTextObject } from "@/lib/editor/types";
import { extractPdfTextObjects } from "@/lib/pdf/extract-text";

/** public/sample.pdf page 2: an upright run on a `/Rotate 90` page. */
const PAGE = {
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  id: "page-2",
  sourceRotate: 90,
} as const;
const RUN_WIDTH = 108;
const RUN_SIZE = 18;

const rotatedPageRun = (): PdfTextObject => {
  const [run] = extractPdfTextObjects(
    {
      items: [
        {
          height: RUN_SIZE,
          str: "Rotated page",
          transform: [RUN_SIZE, 0, 0, RUN_SIZE, 72, 72],
          width: RUN_WIDTH,
        },
      ],
      styles: {},
    },
    PAGE
  );
  if (!run) {
    throw new Error("No run extracted");
  }
  return run;
};

test("a run on a /Rotate 90 page is stored as a tall box running down", () => {
  const run = rotatedPageRun();
  expect(run.rotation).toBeCloseTo(90);
  expect(run.height).toBeCloseTo(RUN_WIDTH);
  expect(run.width).toBeLessThan(RUN_SIZE * 2);
});

test("its unturned strip starts at the baseline and runs the text's length", () => {
  const run = rotatedPageRun();
  const { pivot, rotation } = pdfTextStripTurn(run, PAGE);
  const strip = pdfTextUnturnedBox(run, PAGE, run);
  expect(rotation).toBe(90);
  expect(pivot).toEqual(
    pdfTextBaselineDisplayed(run.transform, PAGE.cropBox, PAGE.sourceRotate)
  );
  expect(strip.x).toBeCloseTo(pivot.x);
  expect(strip.width).toBeCloseTo(RUN_WIDTH);
  expect(strip.height).toBeCloseTo(run.width);
  expect(strip.y).toBeLessThan(pivot.y);
  expect(strip.y + strip.height).toBeGreaterThan(pivot.y);
});

test("longer text grows the box down the page, not across it", () => {
  const run = rotatedPageRun();
  const fitted = fittedPdfTextBox(run, RUN_WIDTH + 40);
  expect(fitted).toEqual({
    height: RUN_WIDTH + 40,
    width: run.width,
    x: run.x,
    y: run.y,
  });
});

test("the run is hit on its glyphs and on the grown part once edited", () => {
  const run = rotatedPageRun();
  const middle = { x: run.x + run.width / 2, y: run.y + run.height / 2 };
  expect(hitTestPdfText([run], middle)?.id).toBe(run.id);

  const edited = { ...run, text: `${run.text} and more words` };
  const belowOriginal = { x: middle.x, y: run.y + run.height + 10 };
  expect(hitTestPdfText([run], belowOriginal)).toBeUndefined();
  expect(hitTestPdfText([edited], belowOriginal)?.id).toBe(run.id);
});
