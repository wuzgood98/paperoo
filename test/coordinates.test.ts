import { expect, test } from "vitest";

import {
  centerRotateCtm,
  DEFAULT_DESCENT_FLOOR,
  displayedCanvasRotation,
  displayedToUserSpace,
  imageCtmToDisplayedBox,
  pdfTextBaselineUserSpace,
  textItemToDisplayedBox,
  userPointToDisplayed,
  pageToScreen,
  pixelSnapOffset,
  resizeRotatedBox,
  rotatePoint,
  screenToPage,
  shownCanvasRotation,
} from "@/lib/editor/coordinates";
import type { CropBox, PageRotation } from "@/lib/editor/types";

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

const letterCrop: CropBox = { height: 792, width: 612, x: 0, y: 0 };
const offsetCropBox: CropBox = { height: 700, width: 500, x: 12, y: 24 };

test("userPointToDisplayed inverts displayedPointToUserSpace on an unrotated page", () => {
  const displayed = { x: 120, y: 80 };
  const user = {
    x: letterCrop.x + displayed.x,
    y: letterCrop.y + letterCrop.height - displayed.y,
  };
  expect(userPointToDisplayed(user, letterCrop, 0)).toEqual(displayed);
});

test("textItemToDisplayedBox places top, middle, and bottom baselines", () => {
  const width = 80;
  const height = 20;
  const ascentRatio = 0.8;
  const cases = [
    { displayedY: 4, name: "top", userY: 772 },
    { displayedY: 380, name: "middle", userY: 396 },
    { displayedY: 736, name: "bottom", userY: 40 },
  ] as const;

  for (const item of cases) {
    const box = textItemToDisplayedBox(
      [height, 0, 0, height, 100, item.userY],
      width,
      height,
      ascentRatio,
      letterCrop,
      0
    );
    expect(box.x, item.name).toBeCloseTo(100);
    expect(box.y, item.name).toBeCloseTo(item.displayedY);
    expect(box.width, item.name).toBeCloseTo(width);
    expect(box.height, item.name).toBeCloseTo(
      height * ascentRatio + height * DEFAULT_DESCENT_FLOOR
    );
    expect(box.fontSize, item.name).toBeCloseTo(height);
    expect(box.rotation, item.name).toBeCloseTo(0);
  }
});

test("textItemToDisplayedBox uses a non-zero crop origin", () => {
  const box = textItemToDisplayedBox(
    [12, 0, 0, 12, 32, 80],
    40,
    12,
    0.8,
    offsetCropBox,
    0
  );
  const user = displayedToUserSpace(box, offsetCropBox, 0);
  expect(user.x).toBeCloseTo(32);
  expect(user.y + user.height - 12 * 0.8).toBeCloseTo(80);
});

test("textItemToDisplayedBox round-trips through displayedToUserSpace for page rotates", () => {
  const height = 20;
  const width = 40;
  const ascentRatio = 0.8;
  const transform = [height, 0, 0, height, 100, 200] as const;
  const belowBaseline = height * DEFAULT_DESCENT_FLOOR;
  const userBox = {
    height: height * ascentRatio + belowBaseline,
    width,
    x: 100,
    y: 200 - belowBaseline,
  };

  const rotates: PageRotation[] = [0, 90, 180, 270];
  for (const rotate of rotates) {
    const displayed = textItemToDisplayedBox(
      transform,
      width,
      height,
      ascentRatio,
      letterCrop,
      rotate
    );
    const user = displayedToUserSpace(displayed, letterCrop, rotate);
    expect(user.x).toBeCloseTo(userBox.x);
    expect(user.y).toBeCloseTo(userBox.y);
    expect(user.width).toBeCloseTo(userBox.width);
    expect(user.height).toBeCloseTo(userBox.height);
  }
});

test("textItemToDisplayedBox covers a descent floor under a high-ascent run", () => {
  const em = 20;
  const ascentRatio = 0.95;
  const descentRatio = -0.2;
  const baselineY = 200;
  const belowBaseline = em * DEFAULT_DESCENT_FLOOR;
  const box = textItemToDisplayedBox(
    [em, 0, 0, em, 100, baselineY],
    40,
    em,
    ascentRatio,
    letterCrop,
    0,
    descentRatio
  );
  const user = displayedToUserSpace(box, letterCrop, 0);

  expect(box.y).toBeCloseTo(letterCrop.height - baselineY - em * ascentRatio);
  expect(box.height).toBeCloseTo(em * ascentRatio + belowBaseline);
  expect(box.fontSize).toBeCloseTo(em);
  expect(user.y).toBeCloseTo(baselineY - belowBaseline);
  expect(user.height).toBeCloseTo(em * ascentRatio + belowBaseline);
  expect(user.y + user.height - em * ascentRatio).toBeCloseTo(baselineY);
});

test("pdfTextBaselineUserSpace keeps the matrix origin through a descent-floor box", () => {
  const em = 20;
  const ascentRatio = 0.9;
  const baselineY = 200;
  const transform = [em, 0, 0, em, 72, baselineY] as const;
  const box = textItemToDisplayedBox(
    transform,
    40,
    em,
    ascentRatio,
    letterCrop,
    0
  );
  const user = displayedToUserSpace(box, letterCrop, 0);
  const liberationNoDescender = 0.6831875 * em;

  expect(user.y + user.height - liberationNoDescender).not.toBeCloseTo(
    baselineY
  );
  expect(pdfTextBaselineUserSpace(transform, letterCrop, 0).y).toBe(baselineY);
});

test("imageCtmToDisplayedBox maps a unit-square CTM into displayed space", () => {
  const crop = { height: 792, width: 612, x: 0, y: 0 };
  const box = imageCtmToDisplayedBox([80, 0, 0, 40, 72, 600], crop, 0);
  expect(box).not.toBeNull();
  expect(box?.width).toBeCloseTo(80);
  expect(box?.height).toBeCloseTo(40);
  expect(box?.x).toBeCloseTo(72);
  expect(box?.y).toBeCloseTo(152);
  expect(box?.rotation).toBeCloseTo(0);

  const user = displayedToUserSpace(
    box ?? { height: 0, width: 0, x: 0, y: 0 },
    crop,
    0
  );
  expect(user.x).toBeCloseTo(72);
  expect(user.y).toBeCloseTo(600);
  expect(user.width).toBeCloseTo(80);
  expect(user.height).toBeCloseTo(40);
});

test("imageCtmToDisplayedBox skips a skewed CTM", () => {
  const crop = { height: 792, width: 612, x: 0, y: 0 };
  expect(imageCtmToDisplayedBox([80, 20, 10, 40, 72, 600], crop, 0)).toBeNull();
});

test("pixelSnapOffset lands left and top on the device-pixel grid", () => {
  for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
    for (const position of [10, 10.2, 10.25, 40.4, 100.75]) {
      const snapped = position + pixelSnapOffset(position, devicePixelRatio);
      expect(snapped * devicePixelRatio).toBeCloseTo(
        Math.round(position * devicePixelRatio)
      );
    }
  }
});

test("displayedCanvasRotation ignores the user's page rotation", () => {
  // Overlay rects are in source-rotated space; user rotation is CSS on top.
  expect(displayedCanvasRotation({ sourceRotate: 0 })).toBe(0);
  expect(displayedCanvasRotation({ sourceRotate: 90 })).toBe(90);
  expect(displayedCanvasRotation({ sourceRotate: 450 })).toBe(90);
});

test("shownCanvasRotation adds the user's page rotation to the source", () => {
  expect(shownCanvasRotation({ rotation: 0, sourceRotate: 0 })).toBe(0);
  expect(shownCanvasRotation({ rotation: 90, sourceRotate: 0 })).toBe(90);
  expect(shownCanvasRotation({ rotation: 270, sourceRotate: 180 })).toBe(90);
});
