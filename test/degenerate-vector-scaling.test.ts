import { readFileSync } from "node:fs";
import path from "node:path";

import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import {
  resizeRotatedBox,
  vectorAxisScale,
  vectorStrokeScale,
} from "@/lib/editor/coordinates";
import { MIN_OBJECT_SIZE } from "@/lib/editor/types";
import type { EditorDocument, PdfVectorObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { loadPdfJsDocument } from "./pdfjs-node";

const FIXTURE = path.join(process.cwd(), "test/fixtures/vector-test.pdf");
const A4_CROP = { height: 841.8898, width: 595.2756, x: 0, y: 0 };
/** Widest stroke the fixture's first page draws. */
const WIDEST_SOURCE_STROKE = 8;
/** The `[6 4] 0 d` line, 3pt wide, at user y 605.8898. */
const DASHED_LINE_TOP = A4_CROP.height - 605.8898;
const resizeOptions = { lockAspect: false, minSize: MIN_OBJECT_SIZE };

const pageOneVectors = async (
  bytes: Uint8Array
): Promise<PdfVectorObject[]> => {
  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const page = await document.getPage(1);
  const list = await page.getOperatorList();
  const objects = extractPdfVectorObjects(
    list,
    { cropBox: A4_CROP, id: "page-1", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
  await task.destroy();
  return objects;
};

const lineWidths = async (bytes: Uint8Array): Promise<number[]> => {
  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const page = await document.getPage(1);
  const list = await page.getOperatorList();
  await task.destroy();
  const widths: number[] = [];
  for (const [index, fn] of list.fnArray.entries()) {
    if (fn === OPS.setLineWidth) {
      widths.push(Number(list.argsArray[index]?.[0]));
    }
  }
  return widths;
};

const documentWith = (object: PdfVectorObject): EditorDocument => ({
  pages: [
    {
      cropBox: A4_CROP,
      height: A4_CROP.height,
      id: "page-1",
      objects: [],
      pdfAnnotationObjects: [],
      pdfImageObjects: [],
      pdfTextObjects: [],
      pdfVectorObjects: [object],
      rotation: 0,
      skippedPdfAnnotationSubtypes: [],
      sourceIndex: 0,
      sourceRotate: 0,
      width: A4_CROP.width,
    },
  ],
});

test("a flat axis never stretches and a line keeps its stroke", () => {
  expect(vectorAxisScale(1e-4, 8)).toBe(1);
  expect(vectorAxisScale(100, 150)).toBeCloseTo(1.5);
  expect(
    vectorStrokeScale({
      height: 8,
      originalHeight: 1e-4,
      originalWidth: 225,
      width: 450,
    })
  ).toBe(1);
  expect(
    vectorStrokeScale({
      height: 200,
      originalHeight: 50,
      originalWidth: 80,
      width: 320,
    })
  ).toBeCloseTo(4);
});

test("resizing a horizontal line from a corner only changes its length", () => {
  const line = { height: 1e-4, width: 225, x: 330, y: 236 };
  const next = resizeRotatedBox(
    line,
    0,
    "se",
    { x: 650, y: 330 },
    resizeOptions
  );

  expect(next.height).toBe(line.height);
  expect(next.y).toBeCloseTo(line.y, 3);
  expect(next.width).toBeCloseTo(320);
});

test("resizing a vertical line from its side handle leaves it unchanged", () => {
  const line = { height: 80, width: 1e-4, x: 40, y: 692 };
  const next = resizeRotatedBox(
    line,
    0,
    "e",
    { x: 120, y: 730 },
    resizeOptions
  );

  expect(next).toEqual(line);
});

test("exporting a resized straight line keeps its stroke width", async () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const vectors = await pageOneVectors(bytes);
  const dashed = vectors.find(
    (object) =>
      object.kind === "line" &&
      Math.abs(object.y - DASHED_LINE_TOP) < 1 &&
      object.originalStroke?.width === 3
  );
  expect(dashed).toBeDefined();
  if (!dashed) {
    return;
  }

  const resized = resizeRotatedBox(
    dashed,
    0,
    "se",
    { x: dashed.x + dashed.width + 60, y: dashed.y + 70 },
    resizeOptions
  );
  const output = await exportDocument({
    assets: {},
    bytes,
    document: documentWith({ ...dashed, ...resized }),
    fontBytes: {},
  });

  const widths = await lineWidths(output);
  expect(Math.max(...widths)).toBeLessThanOrEqual(WIDEST_SOURCE_STROKE);
});
