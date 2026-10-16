import { expect, test } from "vitest";

import {
  hitTestPdfVector,
  pdfLinkOverlappingTextRuns,
} from "@/lib/editor/object-utils";
import type {
  PdfLinkAnnotation,
  PdfTextObject,
  PdfVectorObject,
} from "@/lib/editor/types";
import { sampleBackground } from "@/lib/pdf/sample-background";

import { blankImage, fillRect } from "./pixel-fixture";

const crop = { height: 792, width: 612, x: 0, y: 0 };

const vector = (overrides: Partial<PdfVectorObject>): PdfVectorObject => ({
  commands: [
    { type: "moveTo", x: 100, y: 700 },
    { type: "lineTo", x: 200, y: 700 },
  ],
  deleted: false,
  fill: null,
  height: 1e-4,
  id: "vec",
  kind: "line",
  originalFill: null,
  originalHeight: 1e-4,
  originalRotation: 0,
  originalStroke: { color: "#000000", lineCap: 0, lineJoin: 0, width: 1 },
  originalWidth: 100,
  originalX: 100,
  originalY: 92,
  pageId: "page-1",
  paint: "stroke",
  rotation: 0,
  sourceIndex: 0,
  sourceOperatorIndices: [0],
  stroke: { color: "#000000", lineCap: 0, lineJoin: 0, width: 1 },
  type: "pdf-vector",
  width: 100,
  x: 100,
  y: 92,
  ...overrides,
});

test("vector hit-test still hits near a stroke and misses far from it", () => {
  const line = vector({});
  expect(hitTestPdfVector([line], { x: 150, y: 93 }, crop, 0)?.id).toBe("vec");
  expect(hitTestPdfVector([line], { x: 150, y: 300 }, crop, 0)).toBeUndefined();
});

test("path bounds include curve control points", () => {
  // The control polygon swings far below the end points; the hit-test walks
  // it, so the bounds check must not reject points near the controls.
  const curve = vector({
    commands: [
      { type: "moveTo", x: 100, y: 700 },
      {
        type: "curveTo",
        x1: 100,
        x2: 200,
        x3: 200,
        y1: 400,
        y2: 400,
        y3: 700,
      },
    ],
    id: "curve",
    kind: "path",
  });
  expect(hitTestPdfVector([curve], { x: 150, y: 392 }, crop, 0)?.id).toBe(
    "curve"
  );
});

test("a rect outside its path bounds still hits through the box fallback", () => {
  const rect = vector({
    commands: [{ type: "moveTo", x: 100, y: 700 }],
    height: 50,
    id: "rect",
    kind: "rect",
    width: 50,
    x: 300,
    y: 300,
  });
  expect(hitTestPdfVector([rect], { x: 320, y: 320 }, crop, 0)?.id).toBe(
    "rect"
  );
});

test("cached path bounds follow a crop change", () => {
  const line = vector({});
  expect(hitTestPdfVector([line], { x: 150, y: 93 }, crop, 0)?.id).toBe("vec");
  const shifted = { ...crop, y: 100 };
  expect(hitTestPdfVector([line], { x: 150, y: 93 }, shifted, 0)?.id).toBe(
    hitTestPdfVector([vector({})], { x: 150, y: 93 }, shifted, 0)?.id
  );
});

test("sampleBackground ignores an exclude rect entirely left of the ring", () => {
  // Ring column x=3 is red; x=4 is one blue and one green pixel. Red is the
  // mode only if nothing in the ring is wrongly excluded.
  const source = blankImage(5, 3);
  fillRect(source, 3, 1, 1, 2, 255, 0, 0);
  fillRect(source, 4, 1, 1, 1, 0, 0, 255);
  fillRect(source, 4, 2, 1, 1, 0, 255, 0);
  const sampled = sampleBackground(
    source,
    { height: 2, width: 2, x: 3, y: 1 },
    [{ height: 2, width: 2, x: -2, y: 1 }]
  );
  expect(sampled?.color).toBe("#ff0000");
  expect(sampled?.dominance).toBe(0.5);
});

test("link run lookup is cached per link and run list", () => {
  // SAFETY: the lookup reads only geometry and text from runs.
  const run = {
    height: 12,
    id: "run-1",
    text: "Link",
    width: 40,
    x: 72,
    y: 80,
  } as PdfTextObject;
  const runs = [run];
  // SAFETY: the lookup reads only a link's quads.
  const link = {
    quads: [{ height: 12, width: 40, x: 72, y: 80 }],
  } as PdfLinkAnnotation;

  const first = pdfLinkOverlappingTextRuns(link, runs);
  expect(first.map((item) => item.id)).toEqual(["run-1"]);
  expect(pdfLinkOverlappingTextRuns(link, runs)).toBe(first);
  expect(pdfLinkOverlappingTextRuns(link, [...runs])).not.toBe(first);
});
