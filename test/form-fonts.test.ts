import { expect, test } from "vitest";

import type { PdfFormField } from "@/lib/editor/types";
import {
  formFieldsMissingLetters,
  helveticaCovers,
} from "@/lib/pdf/form-fonts";

const widget = {
  exportValue: null,
  height: 20,
  id: "w",
  pageId: "page-1",
  sourceAnnotId: "1R",
  width: 200,
  x: 0,
  y: 0,
};

const text = (
  name: string,
  value: string,
  originalValue = ""
): PdfFormField => ({
  align: "left",
  comb: false,
  fileSelect: false,
  id: name,
  kind: "text",
  maxLength: null,
  multiline: true,
  name,
  originalValue,
  password: false,
  readOnly: false,
  required: false,
  richText: false,
  value,
  widgets: [widget],
});

/** Stands in for Inter: Latin plus the Twi letters, no CJK. */
const interLike = (codePoint: number): boolean =>
  helveticaCovers(codePoint) ||
  [0x1_86, 0x2_54, 0x1_90, 0x20_b5].includes(codePoint);

test("only filled fields with letters no font draws are reported", () => {
  const fields = [
    text("plain", "Ama Owusu"),
    text("twi", "Ɔkɔ Ɛsi ₵5\nline two"),
    text("cjk", "東京 Tokyo"),
    // Not filled here, so it keeps its own appearance.
    text("untouched", "東京", "東京"),
  ];
  expect(
    formFieldsMissingLetters(fields, [helveticaCovers, interLike])
  ).toEqual([{ letters: ["東", "京"], name: "cjk" }]);
});

test("Helvetica draws Latin-1 and the euro sign, not Twi letters", () => {
  expect(helveticaCovers("é".codePointAt(0) ?? 0)).toBe(true);
  expect(helveticaCovers("€".codePointAt(0) ?? 0)).toBe(true);
  expect(helveticaCovers("ɔ".codePointAt(0) ?? 0)).toBe(false);
});
