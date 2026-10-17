import { PDFDocument } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import {
  createShapeObject,
  insetShapePathBox,
  lineRect,
} from "@/lib/editor/object-utils";
import { DEFAULT_SHAPE_STYLE } from "@/lib/editor/types";
import type {
  EditorDocument,
  PdfVectorObject,
  ShapeKind,
  ShapeObject,
} from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { loadPdfJsDocument } from "./pdfjs-node";

const PAGE_HEIGHT = 792;
const LETTER_CROP = { height: PAGE_HEIGHT, width: 612, x: 0, y: 0 };
const BOX = { height: 100, width: 200, x: 100, y: 100 };
const STROKE_WIDTH = 8;

const shape = (kind: ShapeKind, box = BOX): ShapeObject =>
  createShapeObject(box, {
    ...DEFAULT_SHAPE_STYLE,
    shape: kind,
    strokeWidth: STROKE_WIDTH,
  });

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

const exportedVectors = async (
  object: ShapeObject
): Promise<PdfVectorObject[]> => {
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
  const vectors = extractPdfVectorObjects(
    list,
    { cropBox: LETTER_CROP, id: "page-1", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
  await task.destroy();
  return vectors;
};

const exportedVector = async (
  object: ShapeObject
): Promise<PdfVectorObject | undefined> => {
  const vectors = await exportedVectors(object);
  return vectors.at(0);
};

/** Box around the path's on-curve points, in y-up user space. */
const pathBounds = (vector: PdfVectorObject | undefined) => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of vector?.commands ?? []) {
    if (command.type === "curveTo") {
      xs.push(command.x3);
      ys.push(command.y3);
    } else if (command.type !== "closePath") {
      xs.push(command.x);
      ys.push(command.y);
    }
  }
  return {
    bottom: Math.min(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.max(...ys),
  };
};

const half = STROKE_WIDTH / 2;
const top = PAGE_HEIGHT - BOX.y;
const bottom = PAGE_HEIGHT - BOX.y - BOX.height;
const left = BOX.x;
const right = BOX.x + BOX.width;

test.each(["rect", "circle"] as const)(
  "exported %s path is inset by half its stroke, so the ink fills the box",
  async (kind) => {
    const vector = await exportedVector(shape(kind));
    const bounds = pathBounds(vector);

    expect(vector?.stroke?.width).toBeCloseTo(STROKE_WIDTH);
    expect(bounds.left).toBeCloseTo(left + half, 1);
    expect(bounds.right).toBeCloseTo(right - half, 1);
    expect(bounds.top).toBeCloseTo(top - half, 1);
    expect(bounds.bottom).toBeCloseTo(bottom + half, 1);
  }
);

test("exported line still runs corner to corner", async () => {
  const bounds = pathBounds(await exportedVector(shape("line")));

  expect(bounds.left).toBeCloseTo(left, 1);
  expect(bounds.right).toBeCloseTo(right, 1);
  expect(bounds.top).toBeCloseTo(top, 1);
  expect(bounds.bottom).toBeCloseTo(bottom, 1);
});

test("insetShapePathBox insets by half the stroke on every side", () => {
  expect(insetShapePathBox({ height: 100, width: 200 }, 8)).toEqual({
    height: 92,
    width: 192,
    x: 4,
    y: 4,
  });
});

test("insetShapePathBox keeps a centred, non-zero path when the stroke is wider than the box", () => {
  const path = insetShapePathBox({ height: 4, width: 30 }, 10);

  expect(path.width).toBe(20);
  expect(path.height).toBeGreaterThan(0);
  expect(path.height).toBeLessThan(0.1);
  expect(path.y + path.height / 2).toBeCloseTo(2);
  expect(path.x).toBe(5);
});

test.each(["rect", "circle"] as const)(
  "a translucent filled %s fills only inside its stroke, so no area is painted twice",
  async (kind) => {
    const object = { ...shape(kind), fill: "#ff0000", opacity: 0.5 };
    const vectors = await exportedVectors(object);
    const filled = vectors.find((vector) => vector.fill && !vector.stroke);
    const stroked = vectors.find((vector) => vector.stroke && !vector.fill);

    expect(vectors).toHaveLength(2);
    const fillBounds = pathBounds(filled);
    expect(fillBounds.left).toBeCloseTo(left + STROKE_WIDTH, 1);
    expect(fillBounds.top).toBeCloseTo(top - STROKE_WIDTH, 1);
    const strokeBounds = pathBounds(stroked);
    expect(strokeBounds.left).toBeCloseTo(left + half, 1);
    expect(strokeBounds.top).toBeCloseTo(top - half, 1);
  }
);

test("an opaque filled rect still exports as one fill-and-stroke path", async () => {
  const vectors = await exportedVectors({ ...shape("rect"), fill: "#ff0000" });

  expect(vectors).toHaveLength(1);
  expect(vectors[0]?.fill).not.toBeNull();
  expect(vectors[0]?.stroke).not.toBeNull();
});

test("lineRect keeps a straight line flat instead of flooring it to 1pt", () => {
  expect(lineRect({ x: 50, y: 40 }, { x: 10, y: 40 })).toEqual({
    height: 0,
    width: 40,
    x: 10,
    y: 40,
  });
});

test("a horizontal line exports level", async () => {
  const flat = createShapeObject(
    lineRect({ x: 100, y: 100 }, { x: 300, y: 100 }),
    { ...DEFAULT_SHAPE_STYLE, shape: "line", strokeWidth: STROKE_WIDTH }
  );
  const bounds = pathBounds(await exportedVector(flat));

  expect(bounds.top).toBeCloseTo(PAGE_HEIGHT - 100, 1);
  expect(bounds.bottom).toBeCloseTo(PAGE_HEIGHT - 100, 1);
  expect(bounds.right - bounds.left).toBeCloseTo(200, 1);
});
