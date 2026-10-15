import { afterEach, beforeEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, TextObject } from "@/lib/editor/types";

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

const DRAG_VALUES = [0.9, 0.75, 0.6, 0.45, 0.3] as const;

const opacity = (): number | undefined =>
  editorStore.getState().document.pages[0]?.objects[0]?.opacity;

const dragOpacity = (): void => {
  for (const value of DRAG_VALUES) {
    editorStore.previewEdit(() =>
      editorStore.patchSelected((object) => ({ ...object, opacity: value }))
    );
  }
};

beforeEach(() => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.addObject(overlay());
});

afterEach(() => {
  editorStore.clearDocument();
});

test("a committed slider drag is one undo step", () => {
  dragOpacity();
  expect(opacity()).toBe(DRAG_VALUES.at(-1));
  editorStore.commitPreview();

  editorStore.undo();
  expect(opacity()).toBe(1);

  editorStore.undo();
  expect(editorStore.getState().document.pages[0]?.objects).toHaveLength(0);

  editorStore.redo();
  editorStore.redo();
  expect(opacity()).toBe(DRAG_VALUES.at(-1));
  expect(editorStore.canRedo()).toBe(false);
});

test("undo during an uncommitted drag restores the pre-drag value", () => {
  dragOpacity();
  editorStore.undo();
  expect(opacity()).toBe(1);
});

test("a recorded edit after an uncommitted drag keeps the drag as its own step", () => {
  dragOpacity();
  editorStore.patchSelected((object) => ({ ...object, rotation: 15 }));

  editorStore.undo();
  expect(opacity()).toBe(DRAG_VALUES.at(-1));
  editorStore.undo();
  expect(opacity()).toBe(1);
});

test("a drag that ends on the starting value records nothing", () => {
  editorStore.previewEdit(() =>
    editorStore.patchSelected((object) => ({ ...object, opacity: 0.5 }))
  );
  editorStore.previewEdit(() =>
    editorStore.patchSelected((object) => ({ ...object, opacity: 1 }))
  );
  editorStore.commitPreview();

  editorStore.undo();
  expect(editorStore.getState().document.pages[0]?.objects).toHaveLength(0);
});
