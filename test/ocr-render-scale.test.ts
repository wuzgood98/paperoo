import { expect, test } from "vitest";

import { ocrRenderScale } from "@/lib/ocr/render-scale";

test("uses 150 DPI for a letter page", () => {
  expect(ocrRenderScale(612, 792)).toBeCloseTo(150 / 72);
});

test("caps the long edge of a large page", () => {
  const scale = ocrRenderScale(2000, 3000);
  expect(Math.max(2000, 3000) * scale).toBeCloseTo(1800);
});
