import { expect, test } from "vitest";

import { resizeGestureBox } from "@/components/editor/overlay-gestures";
import type { ResizeHandle } from "@/lib/editor/coordinates";
import { scaleObjectToBox } from "@/lib/editor/object-utils";
import { EDITOR_OBJECT_SOURCE } from "@/lib/editor/types";
import type { DrawingObject, Point } from "@/lib/editor/types";

const drawing = (): DrawingObject => ({
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
});

/** Replay a pointer move sequence the way the overlay gesture does. */
const dragHandle = (
  origin: DrawingObject,
  handle: ResizeHandle,
  path: Point[]
) => {
  let box = { height: 0, width: 0, x: 0, y: 0 };
  for (const point of path) {
    box = resizeGestureBox(origin, handle, point, false);
  }
  const next = scaleObjectToBox(origin, box);
  if (next.type !== "drawing") {
    throw new Error("expected drawing");
  }
  return next;
};

test("dragging the bottom handle down stretches the ink downwards", () => {
  const origin = drawing();
  const next = dragHandle(origin, "s", [
    { x: 140, y: 110 },
    { x: 140, y: 130 },
    { x: 140, y: 140 },
  ]);

  expect(next).toMatchObject({ height: 80, width: 80, x: 100, y: 60 });
  expect(next.points).toEqual([
    { x: 0, y: 0 },
    { x: 80, y: 40 },
    { x: 40, y: 80 },
  ]);
});

test("dragging a side handle inwards shrinks the ink", () => {
  const origin = drawing();
  const next = dragHandle(origin, "e", [
    { x: 170, y: 80 },
    { x: 140, y: 80 },
  ]);

  expect(next).toMatchObject({ height: 40, width: 40, x: 100, y: 60 });
  expect(next.points).toEqual([
    { x: 0, y: 0 },
    { x: 40, y: 20 },
    { x: 20, y: 40 },
  ]);
});

test("dragging the west handle outwards keeps the east edge anchored", () => {
  const origin = drawing();
  const next = dragHandle(origin, "w", [
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ]);

  expect(next).toMatchObject({ height: 40, width: 160, x: 20, y: 60 });
  expect(next.points.map((point) => point.x)).toEqual([0, 160, 80]);
});

test("dragging past the opposite edge and back does not drift the anchor", () => {
  const origin = drawing();
  const next = dragHandle(origin, "s", [
    { x: 140, y: 20 },
    { x: 140, y: 120 },
  ]);

  expect(next).toMatchObject({ height: 60, y: 60 });
});
