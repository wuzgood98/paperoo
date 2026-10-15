import { expect, test } from "vitest";

import { sampleCaptionInk } from "@/lib/pdf/sample-caption-ink";

import { blankImage, fillRect } from "./pixel-fixture";

const FULL = { height: 20, width: 40, x: 0, y: 0 };

test("sampleCaptionInk reads blue fill and underline rule", () => {
  const source = blankImage(40, 20);
  fillRect(source, 2, 2, 30, 10, 0, 0, 255);
  fillRect(source, 2, 16, 30, 2, 0, 0, 255);
  const ink = sampleCaptionInk(source, FULL, 12);
  expect(ink?.fill).toBe("#0000ff");
  expect(ink?.underline?.color).toBe("#0000ff");
  expect(ink?.underline?.offsetFromRunTop).toBeCloseTo(17);
  expect(ink?.underline?.thickness).toBeCloseTo(2);
});

test("sampleCaptionInk keeps black fill when underline is blue", () => {
  const source = blankImage(40, 20);
  fillRect(source, 2, 2, 30, 10, 0, 0, 0);
  fillRect(source, 2, 16, 30, 2, 0, 0, 255);
  const ink = sampleCaptionInk(source, FULL, 12);
  expect(ink?.fill).toBe("#000000");
  expect(ink?.underline?.color).toBe("#0000ff");
});

test("glyph bottoms above the baseline are not taken for the rule", () => {
  const source = blankImage(40, 20);
  // Stems reaching the baseline: wide enough to pass a loose row test.
  for (let x = 2; x < 32; x += 3) {
    fillRect(source, x, 2, 2, 10, 17, 85, 204);
  }
  // A one-pixel rule two rows under the baseline, with a faint AA row below.
  fillRect(source, 2, 14, 30, 1, 17, 85, 204);
  fillRect(source, 2, 15, 30, 1, 200, 215, 240);
  const ink = sampleCaptionInk(source, FULL, 12);
  const underline = ink?.underline;
  expect(underline?.color).toBe("#1155cc");
  expect(underline?.offsetFromRunTop).toBeGreaterThan(14.5);
  expect(underline?.offsetFromRunTop).toBeLessThan(15);
  expect(underline?.thickness).toBeGreaterThan(1);
  expect(underline?.thickness).toBeLessThan(1.5);
});

test("descenders crossing below the baseline are not a rule", () => {
  const source = blankImage(40, 20);
  fillRect(source, 2, 2, 30, 10, 0, 0, 0);
  fillRect(source, 4, 12, 2, 5, 0, 0, 0);
  fillRect(source, 20, 12, 2, 5, 0, 0, 0);
  const ink = sampleCaptionInk(source, FULL, 12);
  expect(ink?.fill).toBe("#000000");
  expect(ink?.underline).toBeNull();
});

test("sampleCaptionInk returns null for near-white image", () => {
  const source = blankImage(20, 10);
  expect(
    sampleCaptionInk(source, { height: 10, width: 20, x: 0, y: 0 }, 8)
  ).toBeNull();
});
