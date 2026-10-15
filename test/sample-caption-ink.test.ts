import { expect, test } from "vitest";

import { sampleCaptionInk } from "@/lib/pdf/sample-caption-ink";

import { blankImage, fillRect } from "./pixel-fixture";

test("sampleCaptionInk reads blue fill and underline rule", () => {
  const source = blankImage(40, 20);
  fillRect(source, 2, 2, 30, 10, 0, 0, 255);
  fillRect(source, 2, 16, 30, 2, 0, 0, 255);
  const ink = sampleCaptionInk(source, {
    height: 20,
    width: 40,
    x: 0,
    y: 0,
  });
  expect(ink?.fill).toBe("#0000ff");
  expect(ink?.underline.color).toBe("#0000ff");
  expect(ink?.underline.thickness).toBeGreaterThan(0);
});

test("sampleCaptionInk keeps black fill when underline is blue", () => {
  const source = blankImage(40, 20);
  fillRect(source, 2, 2, 30, 10, 0, 0, 0);
  fillRect(source, 2, 16, 30, 2, 0, 0, 255);
  const ink = sampleCaptionInk(source, {
    height: 20,
    width: 40,
    x: 0,
    y: 0,
  });
  expect(ink?.fill).toBe("#000000");
  expect(ink?.underline.color).toBe("#0000ff");
});

test("sampleCaptionInk returns null for near-white image", () => {
  const source = blankImage(20, 10);
  expect(
    sampleCaptionInk(source, { height: 10, width: 20, x: 0, y: 0 })
  ).toBeNull();
});
