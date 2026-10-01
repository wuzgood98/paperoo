import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfVectorObject } from "@/lib/editor/types";

const pdfVector = (
  overrides: Partial<PdfVectorObject> = {}
): PdfVectorObject => ({
  commands: [
    { type: "moveTo", x: 72, y: 700 },
    { type: "lineTo", x: 200, y: 700 },
  ],
  deleted: false,
  fill: null,
  height: 2,
  id: "vec-1",
  kind: "line",
  originalFill: null,
  originalHeight: 2,
  originalRotation: 0,
  originalStroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 2,
  },
  originalWidth: 128,
  originalX: 72,
  originalY: 90,
  pageId: "page-1",
  paint: "stroke",
  rotation: 0,
  sourceIndex: 0,
  sourceOperatorIndices: [0],
  stroke: {
    color: "#0000ff",
    lineCap: 0,
    lineJoin: 0,
    width: 2,
  },
  type: "pdf-vector",
  width: 128,
  x: 72,
  y: 90,
  ...overrides,
});

const page = (vector = pdfVector()): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [vector],
  rotation: 0,
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

afterEach(() => {
  editorStore.clearDocument();
});

test("moving a PDF vector then undo restores the original box", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfVector("vec-1");
  editorStore.patchPdfVector((object) => ({ ...object, x: 90, y: 100 }));
  expect(editorStore.selectedPdfVector()?.x).toBe(90);
  editorStore.undo();
  expect(editorStore.selectedPdfVector()?.x).toBe(72);
  expect(editorStore.selectedPdfVector()?.y).toBe(90);
});

test("style, resize, and delete each record history", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfVector("vec-1");
  editorStore.patchPdfVector((object) => ({
    ...object,
    stroke: object.stroke
      ? { ...object.stroke, color: "#ff0000", width: 4 }
      : object.stroke,
  }));
  editorStore.selectPdfVector("vec-1");
  const afterStyle = editorStore.selectedPdfVector();
  expect(afterStyle).toBeDefined();
  if (!afterStyle) {
    return;
  }
  editorStore.commitPdfVector(
    { ...afterStyle, height: 4, width: 160, x: 80 },
    true
  );
  editorStore.selectPdfVector("vec-1");
  editorStore.deleteSelected();

  const current = editorStore.getState().document.pages[0]?.pdfVectorObjects[0];
  expect(current?.deleted).toBe(true);
  expect(current?.width).toBe(160);
  expect(current?.stroke?.color).toBe("#ff0000");

  editorStore.undo();
  expect(
    editorStore.getState().document.pages[0]?.pdfVectorObjects[0]?.deleted
  ).toBe(false);
  editorStore.undo();
  expect(
    editorStore.getState().document.pages[0]?.pdfVectorObjects[0]?.width
  ).toBe(128);
  editorStore.undo();
  expect(
    editorStore.getState().document.pages[0]?.pdfVectorObjects[0]?.stroke?.color
  ).toBe("#0000ff");
});
