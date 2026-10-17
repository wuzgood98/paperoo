import { PDFDocument } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { createShapeObject, isRisingDrag } from "@/lib/editor/object-utils";
import { DEFAULT_SHAPE_STYLE } from "@/lib/editor/types";
import type { EditorDocument, Point, ShapeObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { loadPdfJsDocument } from "./pdfjs-node";

const PAGE_HEIGHT = 792;
const LETTER_CROP = { height: PAGE_HEIGHT, width: 612, x: 0, y: 0 };
const BOX = { height: 100, width: 200, x: 100, y: 100 };
const LINE_STYLE = { ...DEFAULT_SHAPE_STYLE, shape: "line" as const };

const documentWith = (object: ShapeObject): EditorDocument => ({
  pages: [
    {
      cropBox: LETTER_CROP,
      height: PAGE_HEIGHT,
      id: "page-1",
      objects: [object],
      pdfAnnotationObjects: [],
      pdfImageObjects: [],
      pdfTextObjects: [],
      pdfVectorObjects: [],
      rotation: 0,
      skippedPdfAnnotationSubtypes: [],
      sourceIndex: 0,
      sourceRotate: 0,
      width: 612,
    },
  ],
});

/** Endpoints of the exported line, in y-up PDF user space. */
const exportedLineEnds = async (object: ShapeObject): Promise<Point[]> => {
  const source = await PDFDocument.create();
  source.addPage([612, PAGE_HEIGHT]);
  const output = await exportDocument({
    assets: {},
    bytes: await source.save(),
    document: documentWith(object),
    fontBytes: {},
  });

  const task = loadPdfJsDocument(output);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const list = await pdfPage.getOperatorList();
  const [vector] = extractPdfVectorObjects(
    list,
    { cropBox: LETTER_CROP, id: "page-1", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
  await task.destroy();

  return (vector?.commands ?? []).flatMap((command) =>
    command.type === "moveTo" || command.type === "lineTo"
      ? [{ x: command.x, y: command.y }]
      : []
  );
};

/** pdf.js may repeat a point, so compare the path's first and last points. */
const expectEnds = (ends: Point[], [start, end]: [Point, Point]) => {
  const first = ends.at(0);
  const last = ends.at(-1);
  expect(first?.x).toBeCloseTo(start.x, 1);
  expect(first?.y).toBeCloseTo(start.y, 1);
  expect(last?.x).toBeCloseTo(end.x, 1);
  expect(last?.y).toBeCloseTo(end.y, 1);
};

const top = PAGE_HEIGHT - BOX.y;
const bottom = PAGE_HEIGHT - BOX.y - BOX.height;
const left = BOX.x;
const right = BOX.x + BOX.width;

test("exported line runs top-left to bottom-right", async () => {
  const ends = await exportedLineEnds(createShapeObject(BOX, LINE_STYLE));
  expectEnds(ends, [
    { x: left, y: top },
    { x: right, y: bottom },
  ]);
});

test("exported flipped line runs bottom-left to top-right", async () => {
  const ends = await exportedLineEnds(createShapeObject(BOX, LINE_STYLE, true));
  expectEnds(ends, [
    { x: left, y: bottom },
    { x: right, y: top },
  ]);
});

test("rising drags flip lines, falling drags do not", () => {
  expect(isRisingDrag({ x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
  expect(isRisingDrag({ x: 10, y: 0 }, { x: 0, y: 10 })).toBe(true);
  expect(isRisingDrag({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe(false);
  expect(isRisingDrag({ x: 10, y: 10 }, { x: 0, y: 0 })).toBe(false);
});

test("flip is only kept on lines", () => {
  expect(createShapeObject(BOX, DEFAULT_SHAPE_STYLE, true).flip).toBe(
    undefined
  );
  expect(createShapeObject(BOX, LINE_STYLE, true).flip).toBe(true);
});
