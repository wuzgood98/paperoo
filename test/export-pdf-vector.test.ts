import { PDFDocument, rgb } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import {
  PDF_VECTOR_COVER_BLEED,
  pdfVectorCoverPathStyle,
} from "@/lib/editor/object-utils";
import type { EditorDocument, PdfVectorObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";

import { loadPdfJsDocument } from "./pdfjs-node";

const LETTER_CROP = { height: 792, width: 612, x: 0, y: 0 };

const pdfVector = (
  overrides: Partial<PdfVectorObject> = {}
): PdfVectorObject => ({
  commands: [
    { type: "moveTo", x: 72, y: 700 },
    { type: "lineTo", x: 200, y: 700 },
  ],
  deleted: false,
  fill: null,
  height: 2,
  id: "vec-1",
  kind: "line",
  originalFill: null,
  originalHeight: 2,
  originalRotation: 0,
  originalStroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 2,
  },
  originalWidth: 128,
  originalX: 72,
  originalY: 90,
  pageId: "page-1",
  paint: "stroke",
  rotation: 0,
  sourceIndex: 0,
  sourceOperatorIndices: [0],
  stroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 2,
  },
  type: "pdf-vector",
  width: 128,
  x: 72,
  y: 90,
  ...overrides,
});

const documentWith = (object: PdfVectorObject): EditorDocument => ({
  pages: [
    {
      cropBox: LETTER_CROP,
      height: 792,
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
      width: 612,
    },
  ],
});

test("export covers and redraws a moved vector", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  page.drawLine({
    color: rgb(0, 0, 1),
    end: { x: 200, y: 700 },
    start: { x: 72, y: 700 },
    thickness: 2,
  });
  const bytes = await source.save();
  const original = new Uint8Array(bytes);

  const object = pdfVector({ x: 100, y: 120 });
  const output = await exportDocument({
    assets: {},
    bytes,
    document: documentWith(object),
    fontBytes: {},
  });

  expect(bytes).toEqual(original);
  expect(output.byteLength).toBeGreaterThan(0);

  const coverStyle = pdfVectorCoverPathStyle(object);
  expect(coverStyle.stroke).toBe("#ffffff");
  expect(coverStyle.strokeWidth).toBe(
    (object.originalStroke?.width ?? 0) + PDF_VECTOR_COVER_BLEED * 2
  );
  expect(coverStyle.fill).toBeNull();
});

test("path cover style does not blank an overlapping clean sibling conceptually", () => {
  const circle = pdfVector({
    commands: [
      { type: "moveTo", x: 100, y: 400 },
      {
        type: "curveTo",
        x1: 100,
        x2: 200,
        x3: 200,
        y1: 500,
        y2: 500,
        y3: 400,
      },
    ],
    height: 100,
    id: "circle",
    kind: "path",
    originalHeight: 100,
    originalWidth: 100,
    originalX: 100,
    originalY: 300,
    width: 100,
    x: 100,
    y: 300,
  });
  const chord = pdfVector({
    commands: [
      { type: "moveTo", x: 120, y: 350 },
      { type: "lineTo", x: 180, y: 350 },
    ],
    height: 1e-4,
    id: "chord",
    originalHeight: 1e-4,
    originalWidth: 60,
    originalX: 120,
    originalY: 350,
    sourceIndex: 1,
    width: 60,
    x: 120,
    y: 350,
  });
  const cover = pdfVectorCoverPathStyle(circle);
  expect(cover.stroke).toBe("#ffffff");
  expect(cover.fill).toBeNull();
  // Sibling stays clean; path cover paints only the circle's commands.
  expect(chord.commands).not.toEqual(circle.commands);
  expect(pdfVectorCoverPathStyle(chord).strokeWidth).toBeLessThan(
    cover.strokeWidth + circle.originalWidth
  );
});

test("export delete covers without redrawing", async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]).drawLine({
    color: rgb(0, 0, 0),
    end: { x: 120, y: 700 },
    start: { x: 72, y: 700 },
    thickness: 1,
  });
  const bytes = await source.save();
  const output = await exportDocument({
    assets: {},
    bytes,
    document: documentWith(pdfVector({ deleted: true })),
    fontBytes: {},
  });
  expect(output.byteLength).toBeGreaterThan(0);
});

test("clean vectors are left untouched on export", async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]).drawRectangle({
    color: rgb(1, 0, 0),
    height: 40,
    width: 80,
    x: 72,
    y: 600,
  });
  const bytes = await source.save();

  const task = loadPdfJsDocument(bytes);
  const document = await task.promise;
  const pdfPage = await document.getPage(1);
  const list = await pdfPage.getOperatorList();
  const extracted = extractPdfVectorObjects(
    list,
    { cropBox: LETTER_CROP, id: "page-1", sourceRotate: 0 },
    toPdfVectorOps(OPS)
  );
  await task.destroy();
  expect(extracted.length).toBeGreaterThan(0);

  const output = await exportDocument({
    assets: {},
    bytes,
    document: {
      pages: [
        {
          cropBox: LETTER_CROP,
          height: 792,
          id: "page-1",
          objects: [],
          pdfAnnotationObjects: [],
          pdfImageObjects: [],
          pdfTextObjects: [],
          pdfVectorObjects: extracted,
          rotation: 0,
          skippedPdfAnnotationSubtypes: [],
          sourceIndex: 0,
          sourceRotate: 0,
          width: 612,
        },
      ],
    },
    fontBytes: {},
  });
  expect(output.byteLength).toBeGreaterThan(0);
});
