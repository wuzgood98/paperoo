import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "@/lib/editor/types";
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

test("zoomBy no-ops at MIN_ZOOM and MAX_ZOOM", () => {
  editorStore.resetDocument([page()], "demo.pdf");

  editorStore.setZoom(MIN_ZOOM);
  expect(editorStore.getState().zoom).toBe(MIN_ZOOM);
  editorStore.zoomBy(-ZOOM_STEP);
  expect(editorStore.getState().zoom).toBe(MIN_ZOOM);

  editorStore.setZoom(MAX_ZOOM);
  expect(editorStore.getState().zoom).toBe(MAX_ZOOM);
  editorStore.zoomBy(ZOOM_STEP);
  expect(editorStore.getState().zoom).toBe(MAX_ZOOM);
});
