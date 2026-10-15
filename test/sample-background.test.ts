import { expect, test } from "vitest";

import {
  COVER_COLOR_MIN_DOMINANCE,
  sampleBackground,
  toCoverSample,
} from "@/lib/pdf/sample-background";

import { blankImage, fillRect } from "./pixel-fixture";

test("sampleBackground keeps an off-white page color", () => {
  const source = blankImage(30, 20);
  fillRect(source, 0, 0, 30, 20, 248, 248, 248);
  fillRect(source, 8, 6, 14, 8, 20, 20, 20);
  const sampled = sampleBackground(
    source,
    { height: 20, width: 30, x: 0, y: 0 },
    [{ height: 8, width: 14, x: 8, y: 6 }]
  );
  expect(sampled?.color).toBe("#f8f8f8");
  expect(sampled?.dominance).toBeGreaterThan(0.7);
  expect(sampled && toCoverSample(sampled).uncertain).toBe(false);
});

test("sampleBackground flags a mixed ring and still returns the mode", () => {
  const source = blankImage(20, 10);
  fillRect(source, 0, 0, 12, 10, 248, 248, 248);
  fillRect(source, 12, 0, 8, 10, 0, 0, 200);
  const sampled = sampleBackground(
    source,
    {
      height: 10,
      width: 20,
      x: 0,
      y: 0,
    },
    []
  );
  expect(sampled?.color).toBe("#f8f8f8");
  expect(sampled?.dominance).toBeCloseTo(0.6);
  expect(sampled && toCoverSample(sampled)).toEqual({
    color: "#f8f8f8",
    uncertain: true,
  });
});

test("toCoverSample trusts a ring exactly at the dominance threshold", () => {
  expect(
    toCoverSample({ color: "#ffffff", dominance: COVER_COLOR_MIN_DOMINANCE })
      .uncertain
  ).toBe(false);
});

test("sampleBackground ignores excluded neighbouring runs", () => {
  const source = blankImage(20, 10);
  fillRect(source, 0, 0, 20, 10, 248, 248, 248);
  fillRect(source, 0, 0, 10, 10, 0, 0, 0);
  const sampled = sampleBackground(
    source,
    { height: 10, width: 20, x: 0, y: 0 },
    [{ height: 10, width: 10, x: 0, y: 0 }]
  );
  expect(sampled?.color).toBe("#f8f8f8");
  expect(sampled?.dominance).toBe(1);
});
