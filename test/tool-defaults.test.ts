import { afterEach, expect, test } from "vitest";

import {
  createDrawingObject,
  createShapeObject,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import { DEFAULT_SHAPE_STYLE } from "@/lib/editor/types";
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

const stroke = () =>
  createDrawingObject([
    { x: 10, y: 10 },
    { x: 40, y: 30 },
  ]);

afterEach(() => {
  editorStore.clearDocument();
});

test("addObject selects the object and returns to Select by default", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.setTool("draw");
  const object = stroke();
  editorStore.addObject(object);
  const state = editorStore.getState();
  expect(state.tool).toBe("select");
  expect(state.selectedObjectIds).toEqual([object.id]);
});

test("keepTool leaves a repeatable tool active and selects nothing", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.setTool("draw");
  editorStore.addObject(stroke(), { keepTool: true });
  editorStore.addObject(stroke(), { keepTool: true });
  const state = editorStore.getState();
  expect(state.tool).toBe("draw");
  expect(state.selectedObjectIds).toEqual([]);
  expect(state.document.pages[0]?.objects).toHaveLength(2);
});

test("restyling a selected drawing becomes the next drawing's default", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.addObject(stroke());
  editorStore.patchSelected((object) =>
    object.type === "drawing"
      ? { ...object, stroke: "#dc2626", strokeWidth: 4 }
      : object
  );
  editorStore.rememberSelectedStyle();
  expect(editorStore.getState().drawStyle).toEqual({
    stroke: "#dc2626",
    strokeWidth: 4,
  });
});

test("a line's style does not clear the remembered box fill", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.setShapeStyle({ fill: "#facc15" });
  editorStore.addObject(
    createShapeObject(
      { height: 20, width: 20, x: 0, y: 0 },
      { ...DEFAULT_SHAPE_STYLE, shape: "line", stroke: "#2563eb" }
    )
  );
  editorStore.rememberSelectedStyle();
  const { shapeStyle } = editorStore.getState();
  expect(shapeStyle.stroke).toBe("#2563eb");
  expect(shapeStyle.fill).toBe("#facc15");
});

test("new shapes take the current shape style", () => {
  const style = {
    fill: "#16a34a",
    shape: "circle" as const,
    stroke: "#7c3aed",
    strokeWidth: 8,
  };
  const shape = createShapeObject({ height: 10, width: 10, x: 0, y: 0 }, style);
  expect(shape).toMatchObject(style);
});
