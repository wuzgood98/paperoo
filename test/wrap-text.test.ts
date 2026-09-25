import { expect, test } from "vitest";

import { wrapText } from "@/lib/fonts/measure-text";

const measure = (line: string): number => line.length;

test("wrapText keeps lines that fit and wraps on overflow", () => {
  expect(wrapText("hello world", 8, measure)).toEqual(["hello", "world"]);
  expect(wrapText("hi\n\nthere", 20, measure)).toEqual(["hi", "", "there"]);
});
