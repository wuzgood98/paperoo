import { expect, test } from "vitest";

import { displayedToUserSpace } from "@/lib/editor/coordinates";
import { ocrImageBoxToDisplayed } from "@/lib/ocr/map-box";

test("maps a top-left pixel box into displayed page space at render scale", () => {
  const displayed = ocrImageBoxToDisplayed(
    { x0: 100, x1: 300, y0: 40, y1: 80 },
    2
  );
  expect(displayed).toEqual({ height: 20, width: 100, x: 50, y: 20 });
});

test("maps a 90 degree sourceRotate page through displayedToUserSpace", () => {
  const crop = { height: 612, width: 792, x: 0, y: 0 };
  const displayed = ocrImageBoxToDisplayed(
    { x0: 0, x1: 200, y0: 0, y1: 80 },
    2
  );
  const user = displayedToUserSpace(displayed, crop, 90);
  expect(displayed).toEqual({ height: 40, width: 100, x: 0, y: 0 });
  expect(user).toEqual({ height: 100, width: 40, x: 0, y: 0 });
});
