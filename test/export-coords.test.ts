import { expect, test } from "vitest";

import {
  centerRotateCtm,
  displayedToUserSpace,
  textBaselineY,
} from "@/lib/editor/coordinates";
import { editorPageOrder } from "@/lib/editor/object-utils";
import type { CropBox, PageRotation, Rect } from "@/lib/editor/types";

const box: Rect = { height: 20, width: 40, x: 100, y: 50 };
const crop: CropBox = { height: 792, width: 612, x: 0, y: 0 };
const offsetCrop: CropBox = { height: 700, width: 500, x: 12, y: 24 };

const expectedByRotate: Record<PageRotation, Rect> = {
  0: { height: 20, width: 40, x: 100, y: 722 },
  180: { height: 20, width: 40, x: 472, y: 50 },
  270: { height: 40, width: 20, x: 542, y: 652 },
  90: { height: 40, width: 20, x: 50, y: 100 },
};

test("displayedToUserSpace goldens for /Rotate 0/90/180/270", () => {
  for (const rotate of [0, 90, 180, 270] as const) {
    expect(displayedToUserSpace(box, crop, rotate)).toEqual(
      expectedByRotate[rotate]
    );
  }
});

test("displayedToUserSpace goldens for a non-zero CropBox", () => {
  expect(displayedToUserSpace(box, offsetCrop, 0)).toEqual({
    height: 20,
    width: 40,
    x: 112,
    y: 654,
  });
  expect(displayedToUserSpace(box, offsetCrop, 90)).toEqual({
    height: 40,
    width: 20,
    x: 62,
    y: 124,
  });
});

test("text baseline sits at the top of the box minus fontkit ascent", () => {
  const user = displayedToUserSpace(box, crop, 0);
  const ascent = 16;
  expect(textBaselineY(user.height, ascent)).toBe(4);
  expect(user.y + textBaselineY(user.height, ascent)).toBe(726);
});

test("centerRotateCtm at 90 degrees emits a center-pivot matrix", () => {
  const user = displayedToUserSpace(box, crop, 0);
  const cx = user.x + user.width / 2;
  const cy = user.y + user.height / 2;
  const ctm = centerRotateCtm(cx, cy, user.width, user.height, 90);
  expect(ctm[0]).toBeCloseTo(0);
  expect(ctm[1]).toBeCloseTo(1);
  expect(ctm[2]).toBeCloseTo(-1);
  expect(ctm[3]).toBeCloseTo(0);
  expect(ctm[4]).toBeCloseTo(cx + user.height / 2);
  expect(ctm[5]).toBeCloseTo(cy - user.width / 2);
});

test("editorPageOrder follows the editor page list, not source order", () => {
  const pages = [
    { id: "c", sourceIndex: 2 },
    { id: "a", sourceIndex: 0 },
    { id: "d", sourceIndex: 3 },
  ];
  expect(editorPageOrder(pages)).toEqual([2, 0, 3]);
});
