import { readFileSync } from "node:fs";
import path from "node:path";

import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { userPointToDisplayed } from "@/lib/editor/coordinates";
import {
  hitTestPdfText,
  measurePdfTextCoverRects,
  pdfTextFrameCorners,
  pdfTextFrameRotation,
} from "@/lib/editor/object-utils";
import type {
  EditorDocument,
  EditorPage,
  PdfTextObject,
  Point,
} from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";

import { loadPdfJsDocument } from "./pdfjs-node";

const FIXTURE = path.join(process.cwd(), "test/fixtures/vector-test.pdf");
const A4_CROP = { height: 841.8898, width: 595.2756, x: 0, y: 0 };
/** Page 3 draws "Rotated 35°" under `.819 .574 -.574 .819 385.28 270 cm`. */
const ROTATED_TEXT = "Rotated 35°";
const ROTATION_DEG = 35;
const ROTATED_SIZE = 28;
/** And "Horizontally stretched" under `2.5 0 0 1 40 200 cm`, 20pt Times-Bold. */
const STRETCHED_TEXT = "Horizontally stretched";
const STRETCH = 2.5;
const STRETCHED_SIZE = 20;
const TIMES_TEXT_PREFIX = "Times-Roman:";
const PAGE_THREE_INDEX = 2;

const fixtureBytes = (): Uint8Array => new Uint8Array(readFileSync(FIXTURE));

const pageThreeRuns = async (bytes: Uint8Array): Promise<PdfTextObject[]> => {
  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const page = await document.getPage(PAGE_THREE_INDEX + 1);
  // Fonts reach commonObjs during operator-list translation.
  const [content] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const extractable = toExtractableTextContent(content);
  const fontFaces = await collectPdfFontFaces(
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    page.commonObjs as PdfJsFontObjectStore,
    extractable.items
  );
  const runs = extractPdfTextObjects(
    extractable,
    { cropBox: A4_CROP, id: "page-3", sourceRotate: 0 },
    fontFaces
  );
  await task.destroy();
  return runs;
};

const runWithText = (
  runs: readonly PdfTextObject[],
  text: string
): PdfTextObject => {
  const run = runs.find((candidate) => candidate.text.startsWith(text));
  if (!run) {
    throw new Error(`No run starts with "${text}"`);
  }
  return run;
};

const editorPage = (runs: PdfTextObject[]): EditorPage => ({
  cropBox: A4_CROP,
  height: A4_CROP.height,
  id: "page-3",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: runs,
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: PAGE_THREE_INDEX,
  sourceRotate: 0,
  width: A4_CROP.width,
});

const documentWith = (runs: PdfTextObject[]): EditorDocument => ({
  pages: [editorPage(runs)],
});

/** A point along the turned baseline, `along` points in and `up` points above it. */
const pointOnTurnedRun = (along: number, up: number): Point => {
  const radians = (ROTATION_DEG * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return userPointToDisplayed(
    { x: 385.2756 + along * cos - up * sin, y: 270 + along * sin + up * cos },
    A4_CROP,
    0
  );
};

const exportedPageThree = async (
  runs: PdfTextObject[],
  fontBytes: Record<string, Uint8Array> = {}
) => {
  const output = await exportDocument({
    assets: {},
    bytes: fixtureBytes(),
    document: documentWith(runs),
    fontBytes,
  });
  const task = loadPdfJsDocument(output);
  const document = await task.promise;
  const page = await document.getPage(1);
  const [content, operators] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  await task.destroy();
  const items = content.items.flatMap((item) =>
    "str" in item ? [{ str: item.str, transform: item.transform }] : []
  );
  return { items, operators };
};

const edit = (
  runs: PdfTextObject[],
  original: string,
  patch: Partial<PdfTextObject>
): PdfTextObject[] =>
  runs.map((run) =>
    run.text.startsWith(original) ? { ...run, ...patch } : run
  );

test("extraction keeps a turned run's rotation and a stretched run's scale", async () => {
  const runs = await pageThreeRuns(fixtureBytes());
  const rotated = runWithText(runs, ROTATED_TEXT);
  const stretched = runWithText(runs, STRETCHED_TEXT);

  // Displayed space runs y down, so a counter-clockwise turn is negative.
  expect(rotated.rotation).toBeCloseTo(-ROTATION_DEG, 0);
  expect(rotated.horizontalScale).toBeCloseTo(1, 3);
  expect(rotated.fontSize).toBeCloseTo(ROTATED_SIZE, 2);
  expect(stretched.horizontalScale).toBeCloseTo(STRETCH, 3);
  expect(stretched.fontSize).toBeCloseTo(STRETCHED_SIZE, 3);
  expect(pdfTextFrameRotation(stretched)).toBe(0);
});

test("a turned run is hit inside its glyphs, not on a strip from its origin", async () => {
  const runs = await pageThreeRuns(fixtureBytes());
  const rotated = runWithText(runs, ROTATED_TEXT);

  // Halfway along "Rotated 35°", in the x-height.
  const insideGlyphs = pointOnTurnedRun(rotated.width / 2, 8);
  expect(hitTestPdfText(runs, insideGlyphs)?.id).toBe(rotated.id);

  // The old horizontal strip from the baseline origin is empty page.
  const origin = pointOnTurnedRun(0, 0);
  const onOldStrip = { x: origin.x + rotated.width * 0.8, y: origin.y - 8 };
  expect(hitTestPdfText(runs, onOldStrip)?.id).not.toBe(rotated.id);
});

test("a turned run's fallback cover is a turned polygon over its glyphs", async () => {
  const runs = await pageThreeRuns(fixtureBytes());
  const rotated = runWithText(runs, ROTATED_TEXT);
  const [cover] = measurePdfTextCoverRects(rotated, editorPage(runs), runs);
  if (!cover) {
    throw new Error("No cover");
  }
  const corners = pdfTextFrameCorners(rotated, cover);
  const [topLeft, topRight] = corners;

  // The top edge climbs with the baseline instead of staying level.
  expect(topLeft && topRight ? topRight.y - topLeft.y : 0).toBeLessThan(-50);
  // And the far end of the cover reaches the last glyph.
  const lastGlyph = pointOnTurnedRun(rotated.width - 4, 8);
  const xs = corners.map((corner) => corner.x);
  expect(lastGlyph.x).toBeLessThan(Math.max(...xs));
});

test("an edited 35° run exports with a turned text matrix", async () => {
  const runs = edit(await pageThreeRuns(fixtureBytes()), ROTATED_TEXT, {
    text: "Turned 35°",
  });
  const { items } = await exportedPageThree(runs);
  const replacement = items.find((item) => item.str === "Turned 35°");
  if (!replacement) {
    throw new Error("Replacement text missing from export");
  }
  const [a, b, c, d, e, f] = replacement.transform;
  const radians = (ROTATION_DEG * Math.PI) / 180;

  expect(a).toBeCloseTo(ROTATED_SIZE * Math.cos(radians), 1);
  expect(b).toBeCloseTo(ROTATED_SIZE * Math.sin(radians), 1);
  expect(c).toBeCloseTo(-ROTATED_SIZE * Math.sin(radians), 1);
  expect(d).toBeCloseTo(ROTATED_SIZE * Math.cos(radians), 1);
  expect(e).toBeCloseTo(385.2756, 2);
  expect(f).toBeCloseTo(270, 2);
});

test("an edited stretched run keeps its horizontal scale on export", async () => {
  const runs = edit(await pageThreeRuns(fixtureBytes()), STRETCHED_TEXT, {
    text: "Restretched",
  });
  const { items } = await exportedPageThree(runs);
  const replacement = items.find((item) => item.str === "Restretched");
  if (!replacement) {
    throw new Error("Replacement text missing from export");
  }
  const [a, b, c, d] = replacement.transform;

  expect(a).toBeCloseTo(STRETCHED_SIZE * STRETCH, 2);
  expect(b).toBeCloseTo(0, 3);
  expect(c).toBeCloseTo(0, 3);
  expect(d).toBeCloseTo(STRETCHED_SIZE, 2);
});

test("a Times run with a non-WinAnsi character exports in Liberation Sans", async () => {
  const text = "Times-Roman: Ω ≠ ✓";
  const runs = edit(await pageThreeRuns(fixtureBytes()), TIMES_TEXT_PREFIX, {
    text,
  });
  const fontBytes = {
    [FONT_FILES.sans[400]]: new Uint8Array(
      readFileSync(
        path.join(process.cwd(), "public", FONT_FILES.sans[400].slice(1))
      )
    ),
  };
  const { items } = await exportedPageThree(runs, fontBytes);

  expect(items.some((item) => item.str.includes("Ω"))).toBe(true);
});

test("an edited invisible run stays invisible", async () => {
  const runs = edit(await pageThreeRuns(fixtureBytes()), STRETCHED_TEXT, {
    text: "Hidden words",
    textRenderingMode: 3,
  });
  const { operators } = await exportedPageThree(runs);
  const modes = operators.fnArray.flatMap((fn, index) =>
    fn === OPS.setTextRenderingMode ? [operators.argsArray[index]?.[0]] : []
  );

  expect(modes).toContain(3);
  expect(modes).not.toContain(0);
});
