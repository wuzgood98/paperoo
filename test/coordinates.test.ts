import { expect, test } from "vitest";

import {
  centerRotateCtm,
  displayedToUserSpace,
  pageToScreen,
  resizeRotatedBox,
  rotatePoint,
  screenToPage,
} from "@/lib/editor/coordinates";

test("screenToPage and pageToScreen are inverses at zoom 1, 2, and 0.5", () => {
  const bounds = { height: 792, left: 40, top: 80, width: 612 };
  const point = { x: 140, y: 220 };

  for (const zoom of [1, 2, 0.5]) {
    const page = screenToPage(point, bounds, zoom);
    const screen = pageToScreen(page, bounds, zoom);
    expect(screen.x).toBeCloseTo(point.x);
    expect(screen.y).toBeCloseTo(point.y);
  }
});

test("displayedToUserSpace flips Y for an unrotated crop", () => {
  const crop = { height: 792, width: 612, x: 0, y: 0 };
  const user = displayedToUserSpace(
    { height: 20, width: 40, x: 100, y: 50 },
    crop,
    0
  );
  expect(user).toEqual({ height: 20, width: 40, x: 100, y: 722 });
});

test("displayedToUserSpace handles a non-zero crop origin", () => {
  const crop = { height: 700, width: 500, x: 12, y: 24 };
  const user = displayedToUserSpace(
    { height: 10, width: 10, x: 0, y: 0 },
    crop,
    0
  );
  expect(user).toEqual({ height: 10, width: 10, x: 12, y: 714 });
});

test("centerRotateCtm at 0 degrees translates to the bottom-left", () => {
  const ctm = centerRotateCtm(50, 40, 20, 10, 0);
  expect(ctm[4]).toBeCloseTo(40);
  expect(ctm[5]).toBeCloseTo(35);
});

const resizeOptions = { lockAspect: false, minSize: 8 } as const;

test("resizeRotatedBox shrinks from the north handle without moving the bottom", () => {
  const box = { height: 40, width: 80, x: 100, y: 60 };
  const next = resizeRotatedBox(box, 0, "n", { x: 140, y: 70 }, resizeOptions);

  expect(next.height).toBeCloseTo(30);
  expect(next.width).toBeCloseTo(80);
  expect(next.x).toBeCloseTo(100);
  expect(next.y + next.height).toBeCloseTo(100);
});

test("resizeRotatedBox shrinks from the west handle without moving the right", () => {
  const box = { height: 40, width: 80, x: 100, y: 60 };
  const next = resizeRotatedBox(box, 0, "w", { x: 120, y: 80 }, resizeOptions);

  expect(next.width).toBeCloseTo(60);
  expect(next.height).toBeCloseTo(40);
  expect(next.y).toBeCloseTo(60);
  expect(next.x + next.width).toBeCloseTo(180);
});

test("resizeRotatedBox grows from the east and south handles", () => {
  const box = { height: 40, width: 80, x: 100, y: 60 };
  const east = resizeRotatedBox(box, 0, "e", { x: 200, y: 80 }, resizeOptions);
  const south = resizeRotatedBox(
    box,
    0,
    "s",
    { x: 140, y: 120 },
    resizeOptions
  );

  expect(east.width).toBeCloseTo(100);
  expect(east.x).toBeCloseTo(100);
  expect(south.height).toBeCloseTo(60);
  expect(south.y).toBeCloseTo(60);
});

test("resizeRotatedBox keeps size when the pointer sits on the handle", () => {
  const box = { height: 40, width: 80, x: 100, y: 60 };
  const next = resizeRotatedBox(box, 0, "nw", { x: 100, y: 60 }, resizeOptions);

  expect(next.width).toBeCloseTo(80);
  expect(next.height).toBeCloseTo(40);
  expect(next.x).toBeCloseTo(100);
  expect(next.y).toBeCloseTo(60);
});

test("resizeRotatedBox keeps the opposite corner fixed at several angles", () => {
  const box = { height: 40, width: 80, x: 100, y: 60 };

  for (const rotation of [0, 30, 90, 217]) {
    const beforeCenter = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const opposite = rotatePoint(
      { x: beforeCenter.x - 40, y: beforeCenter.y - 20 },
      beforeCenter,
      rotation
    );
    const pointer = rotatePoint(
      { x: beforeCenter.x + 60, y: beforeCenter.y + 30 },
      beforeCenter,
      rotation
    );
    const next = resizeRotatedBox(box, rotation, "se", pointer, resizeOptions);
    const nextCenter = {
      x: next.x + next.width / 2,
      y: next.y + next.height / 2,
    };
    const nextOpposite = rotatePoint(
      { x: nextCenter.x - next.width / 2, y: nextCenter.y - next.height / 2 },
      nextCenter,
      rotation
    );
    expect(nextOpposite.x).toBeCloseTo(opposite.x, 5);
    expect(nextOpposite.y).toBeCloseTo(opposite.y, 5);
    expect(next.width).toBeCloseTo(100);
    expect(next.height).toBeCloseTo(50);
  }
});
