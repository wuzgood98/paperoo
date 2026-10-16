import { expect, test } from "vitest";

import {
  EMPTY_PDF_HOVER,
  samePdfHover,
} from "@/components/editor/overlay-pdf-hit";
import {
  hitTestPdfFormField,
  pdfFormWidgetsOnPage,
} from "@/lib/editor/object-utils";
import type { PdfFormModel, PdfFormTextField } from "@/lib/editor/types";

const textField = (
  id: string,
  pageId: string,
  y: number
): PdfFormTextField => ({
  align: "left",
  comb: false,
  fileSelect: false,
  id,
  kind: "text",
  maxLength: null,
  multiline: false,
  name: id,
  originalValue: "",
  password: false,
  readOnly: false,
  required: false,
  richText: false,
  value: "",
  widgets: [
    {
      exportValue: null,
      height: 20,
      id: `${id}-widget`,
      pageId,
      sourceAnnotId: `${id}R`,
      width: 200,
      x: 72,
      y,
    },
  ],
});

const form = (fields: PdfFormTextField[]): PdfFormModel => ({
  fields,
  hasJavaScript: false,
  hasXfa: false,
  signatures: [],
});

test("samePdfHover compares every hover target id", () => {
  expect(samePdfHover(EMPTY_PDF_HOVER, { ...EMPTY_PDF_HOVER })).toBe(true);
  expect(
    samePdfHover(EMPTY_PDF_HOVER, { ...EMPTY_PDF_HOVER, textId: "run-1" })
  ).toBe(false);
  expect(
    samePdfHover(
      { ...EMPTY_PDF_HOVER, vectorId: "v-1" },
      { ...EMPTY_PDF_HOVER, vectorId: "v-2" }
    )
  ).toBe(false);
});

test("form widgets are indexed once per form and grouped by page", () => {
  const model = form([
    textField("a", "page-1", 100),
    textField("b", "page-2", 100),
    textField("c", "page-1", 300),
  ]);

  const first = pdfFormWidgetsOnPage({ form: model }, "page-1");
  expect(first.map(({ field }) => field.id)).toEqual(["a", "c"]);
  expect(pdfFormWidgetsOnPage({ form: model }, "page-1")).toBe(first);
  expect(pdfFormWidgetsOnPage({ form: model }, "page-3")).toEqual([]);

  const edited = form([textField("a", "page-1", 100)]);
  expect(
    pdfFormWidgetsOnPage({ form: edited }, "page-1").map(
      ({ field }) => field.id
    )
  ).toEqual(["a"]);
});

test("hitTestPdfFormField prefers the last widget when widgets overlap", () => {
  const model = form([
    textField("under", "page-1", 100),
    textField("over", "page-1", 100),
  ]);
  expect(
    hitTestPdfFormField({ form: model }, "page-1", { x: 80, y: 105 })?.id
  ).toBe("over");
});
