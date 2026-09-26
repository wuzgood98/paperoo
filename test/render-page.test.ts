import { expect, test } from "vitest";

import { canvasBackingSize } from "@/lib/pdf/render-page";

const LAYOUT_WIDTH = 612;
const LAYOUT_HEIGHT = 792;

test("canvas backing store matches device pixel ratio", () => {
  for (const pixelRatio of [1, 1.25, 1.5, 2]) {
    const backing = canvasBackingSize(LAYOUT_WIDTH, LAYOUT_HEIGHT, pixelRatio);

    expect(backing.cssWidth).toBe(LAYOUT_WIDTH);
    expect(backing.cssHeight).toBe(LAYOUT_HEIGHT);
    expect(backing.width / backing.cssWidth).toBeCloseTo(pixelRatio);
    expect(backing.height / backing.cssHeight).toBeCloseTo(pixelRatio);
    expect(backing.width).toBe(Math.round(LAYOUT_WIDTH * pixelRatio));
    expect(backing.height).toBe(Math.round(LAYOUT_HEIGHT * pixelRatio));
  }
});

test("canvas backing transform is omitted at 1x", () => {
  expect(
    canvasBackingSize(LAYOUT_WIDTH, LAYOUT_HEIGHT, 1).transform
  ).toBeNull();
});

test("canvas backing transform maps one CSS pixel to one device pixel", () => {
  const backing = canvasBackingSize(LAYOUT_WIDTH, LAYOUT_HEIGHT, 2);
  expect(backing.transform).toEqual([2, 0, 0, 2, 0, 0]);
});
