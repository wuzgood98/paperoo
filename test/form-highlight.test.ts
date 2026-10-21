import { expect, test } from "vitest";

import {
  highlightFormFields,
  setHighlightFormFields,
} from "@/lib/editor/form-highlight";

test("field highlighting is on until turned off, even without storage", () => {
  expect(highlightFormFields()).toBe(true);
  setHighlightFormFields(false);
  expect(highlightFormFields()).toBe(false);
  setHighlightFormFields(true);
  expect(highlightFormFields()).toBe(true);
});
