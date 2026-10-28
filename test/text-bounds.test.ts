import { expect, test } from "vitest";

import {
  positionedTextItems,
  textClearOfBoxes,
  textOverlapsBoxes,
} from "@/lib/pdf/output-pages";

// A 12 pt vertical column at x 100, running from y 700 down to y 580.
const column = {
  fontName: "g_d0_f1",
  height: 120,
  str: "縦書きの秘密の名前です",
  transform: [12, 0, 0, 12, 100, 700],
  width: 12,
};
const lowerPart = { height: 20, width: 20, x: 90, y: 585 };

test("a box over the lower part of a vertical column touches it", () => {
  const [item] = positionedTextItems({
    items: [column],
    styles: { g_d0_f1: { vertical: true } },
  });

  expect(item?.vertical).toBe(true);
  expect(item && textClearOfBoxes(item, [lowerPart])).toBe(false);
  expect(item && textOverlapsBoxes(item, [lowerPart])).toBe(true);
});

test("a vertical column does not reach above or beside itself", () => {
  const [item] = positionedTextItems({
    items: [column],
    styles: { g_d0_f1: { vertical: true } },
  });
  const above = { height: 20, width: 20, x: 90, y: 720 };
  const beside = { height: 20, width: 20, x: 130, y: 600 };

  expect(item && textClearOfBoxes(item, [above, beside])).toBe(true);
});

test("horizontal runs keep their usual box", () => {
  const items = positionedTextItems({
    items: [
      { ...column, height: 12, str: "Name", width: 40 },
      { type: "beginMarkedContent" },
      { ...column, str: "  " },
    ],
  });

  expect(items).toHaveLength(1);
  expect(items[0]?.vertical).toBe(false);
  expect(items[0] && textClearOfBoxes(items[0], [lowerPart])).toBe(true);
  expect(
    items[0] &&
      textOverlapsBoxes(items[0], [{ height: 5, width: 5, x: 110, y: 703 }])
  ).toBe(true);
});
