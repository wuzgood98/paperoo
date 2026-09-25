import { expect, test } from "vitest";

import { displayedToUserSpace } from "@/lib/editor/coordinates";

test("reordering source indices produces the export copy order", () => {
  const sourceIndices = [0, 1, 2, 3];
  const editorOrder = [2, 0, 3];
  const copied = editorOrder.map((index) => sourceIndices[index]);
  expect(copied).toEqual([2, 0, 3]);
});

test("90 degree displayed boxes swap width and height in user space", () => {
  const crop = { height: 612, width: 792, x: 0, y: 0 };
  const user = displayedToUserSpace(
    { height: 10, width: 40, x: 5, y: 15 },
    crop,
    90
  );
  expect(user.width).toBe(10);
  expect(user.height).toBe(40);
  expect(user.x).toBe(15);
  expect(user.y).toBe(5);
});
