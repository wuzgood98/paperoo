import { expect, test } from "vitest";

import {
  hitTestOcrWord,
  ocrWordRangeIds,
  visibleOcrWords,
} from "@/lib/ocr/hit";
import type { OcrTextObject } from "@/lib/ocr/types";

const word = (
  id: string,
  x: number,
  overrides: Partial<OcrTextObject> = {}
): OcrTextObject => ({
  baselineY: 20,
  height: 10,
  id,
  lineId: "line-1",
  pageId: "page-1",
  source: "ocr",
  text: id,
  type: "ocr-text",
  width: 20,
  x,
  y: 10,
  ...overrides,
});

test("hits a word at a point inside its box", () => {
  const words = [word("a", 0), word("b", 30)];
  expect(hitTestOcrWord(words, { x: 35, y: 12 })?.id).toBe("b");
  expect(hitTestOcrWord(words, { x: 80, y: 12 })).toBeUndefined();
});

test("range selection includes words between the anchors", () => {
  const words = [word("a", 0), word("b", 30), word("c", 60)];
  expect(ocrWordRangeIds(words, "a", "c")).toEqual(["a", "b", "c"]);
  expect(ocrWordRangeIds(words, "c", "b")).toEqual(["b", "c"]);
});

test("visible words omit suppressed ids", () => {
  const words = [word("a", 0), word("b", 30)];
  expect(visibleOcrWords(words, ["a"]).map((item) => item.id)).toEqual(["b"]);
});
