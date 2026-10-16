import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { hitTestPdfVector, pdfTextCoverRects } from "@/lib/editor/object-utils";
import type {
  EditorPage,
  PdfTextObject,
  PdfVectorObject,
  Rect,
} from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { extractFigmaPage } from "./figma-extract";
import {
  buildFigmaType3Fixture,
  FIGMA_BODY,
  FIGMA_HEADING,
  GLYPH_WIDTH,
} from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const PAGE = { height: 612, width: 792 };

/**
 * A hairline just above the heading's glyph ink but inside its run box: the
 * kind of neighbouring artwork (an arrow) a rect cover used to erase.
 */
const RULE_EM_ABOVE_BASELINE = 0.78;
const ruleY = FIGMA_HEADING.y + FIGMA_HEADING.size * RULE_EM_ABOVE_BASELINE;
const ruleRight =
  FIGMA_HEADING.x +
  FIGMA_HEADING.text.length * GLYPH_WIDTH * FIGMA_HEADING.size;
const RULE = `q 0 0 0 RG 0.5 w ${FIGMA_HEADING.x} ${ruleY} m ${ruleRight} ${ruleY} l S Q`;

const editorPage = (
  runs: PdfTextObject[],
  vectors: PdfVectorObject[]
): EditorPage => ({
  cropBox: { ...PAGE, x: 0, y: 0 },
  height: PAGE.height,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: runs,
  pdfVectorObjects: vectors,
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: PAGE.width,
});

const editHeading = (
  runs: readonly PdfTextObject[],
  patch: Partial<PdfTextObject> = {}
): PdfTextObject[] =>
  runs.map((run) =>
    run.text === FIGMA_HEADING.text
      ? {
          ...run,
          // What the browser measures before export (Node has no canvas): the
          // run box. Outline-backed runs ignore it.
          coverRects: [
            { height: run.height, width: run.width, x: run.x, y: run.y },
          ],
          text: "S",
          ...patch,
        }
      : run
  );

const overlaps = (left: Rect, right: Rect): boolean =>
  Math.min(left.x + left.width, right.x + right.width) >
    Math.max(left.x, right.x) &&
  Math.min(left.y + left.height, right.y + right.height) >
    Math.max(left.y, right.y);

/** White fills the export appended, and the rule, read back from the output. */
const exportedPaint = async (output: Uint8Array) => {
  const pdf = await loadPdfJsDocument(output).promise;
  const page = await pdf.getPage(1);
  const vectors = extractPdfVectorObjects(
    await page.getOperatorList(),
    { cropBox: { ...PAGE, x: 0, y: 0 }, id: "out", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
  return {
    covers: vectors.filter((vector) => vector.fill?.color === "#ffffff"),
    rule: vectors.find((vector) => vector.stroke?.color === "#000000"),
  };
};

const exportEdited = async (
  bytes: Uint8Array,
  runs: PdfTextObject[],
  vectors: PdfVectorObject[]
) =>
  await exportDocument({
    assets: {},
    bytes,
    document: { pages: [editorPage(runs, vectors)] },
    fontBytes: {},
  });

test("an edited outline-backed run is covered by its outline, sparing art beside it", async () => {
  const bytes = await buildFigmaType3Fixture([FIGMA_HEADING, FIGMA_BODY], RULE);
  const { runs, vectors } = await extractFigmaPage(bytes);

  const { covers, rule } = await exportedPaint(
    await exportEdited(bytes, editHeading(runs), vectors)
  );

  const outline = vectors.find((vector) => vector.textInk === true);
  expect(rule).toBeDefined();
  expect(covers).toHaveLength(1);
  const [cover] = covers;
  expect(cover?.y).toBeCloseTo(outline?.y ?? Number.NaN, 1);
  expect(cover?.height).toBeCloseTo(outline?.height ?? Number.NaN, 1);
  expect(rule && cover && overlaps(cover, rule)).toBe(false);
  // Filled and stroked, so the original's antialiased edge is covered too.
  expect(cover?.paint).toBe("fillStroke");
  expect(cover?.stroke?.color).toBe("#ffffff");
});

test("without the outline link the old rect cover erases that art", async () => {
  const bytes = await buildFigmaType3Fixture([FIGMA_HEADING, FIGMA_BODY], RULE);
  const { runs, vectors } = await extractFigmaPage(bytes);
  const unlinked = editHeading(runs, { inkVectorId: undefined });

  const { covers, rule } = await exportedPaint(
    await exportEdited(bytes, unlinked, vectors)
  );

  expect(rule && covers.some((cover) => overlaps(cover, rule))).toBe(true);
});

test("an outline-backed run's cover rect is its ink box", async () => {
  const { runs, vectors } = await extractFigmaPage(
    await buildFigmaType3Fixture()
  );
  const heading = runs.find((run) => run.text === FIGMA_HEADING.text);
  const outline = vectors.find((vector) => vector.id === heading?.inkVectorId);

  const rects = heading
    ? pdfTextCoverRects(heading, editorPage(runs, vectors))
    : [];

  expect(rects).toEqual([
    {
      height: outline?.originalHeight,
      width: outline?.originalWidth,
      x: outline?.originalX,
      y: outline?.originalY,
    },
  ]);
});

test("a glyph outline cannot be hit-tested as a vector", async () => {
  const { vectors } = await extractFigmaPage(await buildFigmaType3Fixture());
  const [outline] = vectors;
  const center = outline
    ? { x: outline.x + outline.width / 2, y: outline.y + outline.height / 2 }
    : { x: 0, y: 0 };
  const crop = { ...PAGE, x: 0, y: 0 };

  expect(hitTestPdfVector(vectors, center, crop, 0)).toBeUndefined();
  const plain = vectors.map((vector) => ({ ...vector, textInk: false }));
  expect(hitTestPdfVector(plain, center, crop, 0)?.id).toBe(outline?.id);
});
