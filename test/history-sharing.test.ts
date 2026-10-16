import { afterEach, expect, test } from "vitest";

import { sameValue } from "@/lib/editor/history";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, TextObject } from "@/lib/editor/types";

const page = (id: string, sourceIndex: number): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id,
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex,
  sourceRotate: 0,
  width: 612,
});

const overlay = (): TextObject => ({
  align: "left",
  color: "#111827",
  content: "Overlay",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 28,
  id: "overlay-1",
  italic: false,
  opacity: 1,
  rotation: 0,
  source: "overlay",
  type: "text",
  width: 120,
  x: 40,
  y: 40,
});

afterEach(() => {
  editorStore.clearDocument();
});

test("undo restores the same page objects instead of copies", () => {
  editorStore.resetDocument([page("p1", 0), page("p2", 1)], "demo.pdf");
  const before = editorStore.getState().document;

  editorStore.addObject(overlay());
  const after = editorStore.getState().document;
  expect(after.pages[1]).toBe(before.pages[1]);

  editorStore.undo();
  expect(editorStore.getState().document).toBe(before);

  editorStore.redo();
  expect(editorStore.getState().document).toBe(after);
});

test("store documents are frozen so mutation cannot corrupt history", () => {
  editorStore.resetDocument([page("p1", 0)], "demo.pdf");
  editorStore.addObject(overlay());
  const [first] = editorStore.getState().document.pages;
  if (!first) {
    throw new Error("expected a page");
  }

  expect(Object.isFrozen(first)).toBe(true);
  expect(() => {
    first.objects.push(overlay());
  }).toThrow(TypeError);
});

test("hydrated pages are shared with history, not cloned per snapshot", () => {
  editorStore.resetDocument([page("p1", 0)], "demo.pdf");
  editorStore.addObject(overlay());
  const late = page("p2", 1);
  editorStore.appendPages([late]);

  editorStore.undo();
  expect(editorStore.getState().document.pages[1]).toBe(late);
});

test("sameValue compares structure and short-circuits shared references", () => {
  const shared = { deep: [1, 2, { x: 3 }] };
  expect(sameValue({ a: shared }, { a: shared })).toBe(true);
  expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
  expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
  expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
  expect(sameValue({ a: undefined }, {})).toBe(true);
  expect(sameValue({ a: null }, {})).toBe(false);
  expect(sameValue([1], { 0: 1 })).toBe(false);
});
