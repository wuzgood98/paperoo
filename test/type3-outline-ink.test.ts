import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import type { PdfTextObject, PdfVectorObject } from "@/lib/editor/types";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";
import { linkTextInkOutlines } from "@/lib/pdf/link-text-ink";

import { extractFigmaPage } from "./figma-extract";
import {
  buildFigmaType3Fixture,
  FIGMA_BODY,
  FIGMA_HEADING,
} from "./figma-type3-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

const byText = (runs: readonly PdfTextObject[], text: string) =>
  runs.find((run) => run.text === text);

test("Figma runs are marked as having invisible glyphs", async () => {
  const { runs } = await extractFigmaPage(await buildFigmaType3Fixture());

  expect(byText(runs, FIGMA_HEADING.text)?.invisibleGlyphs).toBe(true);
});

test("each Figma outline path is tagged as text ink", async () => {
  const { vectors } = await extractFigmaPage(await buildFigmaType3Fixture());

  expect(vectors).toHaveLength(2);
  expect(vectors.every((vector) => vector.textInk === true)).toBe(true);
});

test("Figma runs take their color from their outline path", async () => {
  const { runs } = await extractFigmaPage(await buildFigmaType3Fixture());
  const heading = byText(runs, FIGMA_HEADING.text);
  const body = byText(runs, FIGMA_BODY.text);

  expect(heading?.color).toBe("#1a1a1a");
  expect(heading?.originalColor).toBe("#1a1a1a");
  expect(body?.color).toBe("#737373");
});

test("each Figma run links its own outline, unshared", async () => {
  const { runs, vectors } = await extractFigmaPage(
    await buildFigmaType3Fixture()
  );
  const heading = byText(runs, FIGMA_HEADING.text);
  const body = byText(runs, FIGMA_BODY.text);

  expect(heading?.inkVectorId).toBeDefined();
  expect(heading?.inkVectorId).not.toBe(body?.inkVectorId);
  expect(heading?.inkShared).toBe(false);
  const outline = vectors.find((vector) => vector.id === heading?.inkVectorId);
  expect(outline?.fill?.color).toBe("#1a1a1a");
});

test("paths are not text ink without the paint-nothing font list", async () => {
  const bytes = await buildFigmaType3Fixture();
  const pdf = await loadPdfJsDocument(bytes).promise;
  const page = await pdf.getPage(1);
  const vectors = extractPdfVectorObjects(
    await page.getOperatorList(),
    {
      cropBox: { height: 612, width: 792, x: 0, y: 0 },
      id: "page-1",
      sourceRotate: 0,
    },
    toPdfVectorOps(OPS)
  );

  expect(vectors.some((vector) => vector.textInk === true)).toBe(false);
});

// SAFETY: linking reads only id, geometry, fill, and textInk.
const redOutline = {
  fill: { color: "#ff0000" },
  height: 10,
  id: "outline",
  textInk: true,
  width: 100,
  x: 0,
  y: 0,
} as PdfVectorObject;

const invisibleRun = (id: string, x: number): PdfTextObject =>
  // SAFETY: linking reads only id, geometry, color, and invisibleGlyphs.
  ({
    color: "#000000",
    height: 12,
    id,
    invisibleGlyphs: true,
    originalColor: "#000000",
    width: 50,
    x,
    y: -1,
  }) as PdfTextObject;

test("an outline two runs overlap is shared", () => {
  const linked = linkTextInkOutlines(
    [invisibleRun("a", 0), invisibleRun("b", 50)],
    [redOutline]
  );

  expect(linked.map((item) => item.inkShared)).toEqual([true, true]);
  expect(linked.map((item) => item.color)).toEqual(["#ff0000", "#ff0000"]);
});

test("runs with visible glyphs are never linked", () => {
  // SAFETY: linking reads only id, geometry, color, and invisibleGlyphs.
  const visible = {
    color: "#000000",
    height: 12,
    id: "visible",
    width: 100,
    x: 0,
    y: -1,
  } as PdfTextObject;

  const [linked] = linkTextInkOutlines([visible], [redOutline]);

  expect(linked?.inkVectorId).toBeUndefined();
  expect(linked?.color).toBe("#000000");
});
