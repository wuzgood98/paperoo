import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";

const page = (): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

afterEach(() => {
  editorStore.clearDocument();
});

test("canUndo and canRedo flip across edit, undo, and redo", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  expect(editorStore.canUndo()).toBe(false);
  expect(editorStore.canRedo()).toBe(false);

  editorStore.addObject({
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
  expect(editorStore.canUndo()).toBe(true);
  expect(editorStore.canRedo()).toBe(false);

  editorStore.undo();
  expect(editorStore.canUndo()).toBe(false);
  expect(editorStore.canRedo()).toBe(true);

  editorStore.redo();
  expect(editorStore.canUndo()).toBe(true);
  expect(editorStore.canRedo()).toBe(false);
});
