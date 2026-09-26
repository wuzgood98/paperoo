import { expect, test } from "vitest";

import { resizeRotatedBox, rotatePoint } from "@/lib/editor/coordinates";
import {
  boundsFromPoints,
  fittedPdfTextBox,
  fittedPdfTextWidth,
  scaleObjectToBox,
  scaleSignaturePoints,
  SIGNATURE_PLACE_SIZE,
} from "@/lib/editor/object-utils";
import { EDITOR_OBJECT_SOURCE } from "@/lib/editor/types";
import type { DrawingObject, TextObject } from "@/lib/editor/types";

const drawing = (overrides: Partial<DrawingObject> = {}): DrawingObject => ({
  height: 40,
  id: "draw-1",
  opacity: 1,
  points: [
    { x: 0, y: 0 },
    { x: 80, y: 20 },
    { x: 40, y: 40 },
  ],
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  stroke: "#111827",
  strokeWidth: 2,
  type: "drawing",
  width: 80,
  x: 100,
  y: 60,
  ...overrides,
});

const text = (overrides: Partial<TextObject> = {}): TextObject => ({
  align: "left",
  color: "#111827",
  content: "Text",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 40,
  id: "text-1",
  italic: false,
  opacity: 1,
  rotation: 0,
  source: EDITOR_OBJECT_SOURCE,
  type: "text",
  width: 80,
  x: 100,
  y: 60,
  ...overrides,
});

test("scaleObjectToBox keeps drawing points inside a uniform resize", () => {
  const object = drawing();
  const nextBox = { height: 80, width: 160, x: 100, y: 60 };
  const next = scaleObjectToBox(object, nextBox);

  expect(next.width).toBe(160);
  expect(next.height).toBe(80);
  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  expect(next.points).toEqual([
    { x: 0, y: 0 },
    { x: 160, y: 40 },
    { x: 80, y: 80 },
  ]);
  for (const point of next.points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(next.width);
    expect(point.y).toBeLessThanOrEqual(next.height);
  }
});

test("scaleObjectToBox keeps drawing points inside a non-uniform resize", () => {
  const object = drawing();
  const nextBox = { height: 20, width: 120, x: 90, y: 70 };
  const next = scaleObjectToBox(object, nextBox);

  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  expect(next.points).toEqual([
    { x: 0, y: 0 },
    { x: 120, y: 10 },
    { x: 60, y: 20 },
  ]);
  for (const point of next.points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(next.width);
    expect(point.y).toBeLessThanOrEqual(next.height);
  }
});

test("resize then scale keeps the opposite corner fixed and points inside", () => {
  const object = drawing();
  const box = {
    height: object.height,
    width: object.width,
    x: object.x,
    y: object.y,
  };
  const nextBox = resizeRotatedBox(
    box,
    0,
    "se",
    { x: 220, y: 140 },
    {
      lockAspect: false,
      minSize: 8,
    }
  );
  const next = scaleObjectToBox(object, nextBox);

  expect(next.x).toBeCloseTo(100);
  expect(next.y).toBeCloseTo(60);
  expect(next.width).toBeCloseTo(120);
  expect(next.height).toBeCloseTo(80);
  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  for (const point of next.points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(next.width);
    expect(point.y).toBeLessThanOrEqual(next.height);
  }

  const opposite = rotatePoint(
    { x: box.x, y: box.y },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    0
  );
  expect(next.x).toBeCloseTo(opposite.x);
  expect(next.y).toBeCloseTo(opposite.y);
});

test("scaleSignaturePoints centers a bottom-right stroke in the place box", () => {
  const points = [
    { x: 300, y: 100 },
    { x: 400, y: 140 },
  ];
  const scaled = scaleSignaturePoints(points, SIGNATURE_PLACE_SIZE);
  const bounds = boundsFromPoints(scaled);

  expect(bounds.x + bounds.width / 2).toBeCloseTo(
    SIGNATURE_PLACE_SIZE.width / 2
  );
  expect(bounds.y + bounds.height / 2).toBeCloseTo(
    SIGNATURE_PLACE_SIZE.height / 2
  );
  expect(bounds.x).toBeGreaterThanOrEqual(1);
  expect(bounds.y).toBeGreaterThanOrEqual(1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    SIGNATURE_PLACE_SIZE.width - 1
  );
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    SIGNATURE_PLACE_SIZE.height - 1
  );
});

test("fittedPdfTextWidth never shrinks below the original run", () => {
  expect(fittedPdfTextWidth(90, 40)).toBe(90);
  expect(fittedPdfTextWidth(90, 90)).toBe(90);
  expect(fittedPdfTextWidth(90, 160)).toBe(160);
});

test("fittedPdfTextBox grows left for rtl and right for ltr", () => {
  const ltr = fittedPdfTextBox(
    { dir: "ltr", height: 18, width: 90, x: 72, y: 74 },
    160
  );
  expect(ltr).toEqual({ height: 18, width: 160, x: 72, y: 74 });

  const rtl = fittedPdfTextBox(
    { dir: "rtl", height: 18, width: 90, x: 72, y: 74 },
    160
  );
  expect(rtl).toEqual({ height: 18, width: 160, x: 2, y: 74 });
});

test("scaleObjectToBox scales text font size with height", () => {
  const next = scaleObjectToBox(text(), {
    height: 80,
    width: 160,
    x: 100,
    y: 60,
  });
  expect(next.type).toBe("text");
  if (next.type !== "text") {
    return;
  }
  expect(next.fontSize).toBe(32);
  expect(next.width).toBe(160);
  expect(next.height).toBe(80);
});
