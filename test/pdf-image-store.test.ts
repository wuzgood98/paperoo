import { afterEach, expect, test } from "vitest";

import { pdfImageWithGestureBox } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfImageObject } from "@/lib/editor/types";

const pdfImage = (overrides: Partial<PdfImageObject> = {}): PdfImageObject => ({
  deleted: false,
  height: 40,
  id: "img-1",
  originalHeight: 40,
  originalRotation: 0,
  originalWidth: 80,
  originalX: 72,
  originalY: 152,
  pageId: "page-1",
  previewAssetId: null,
  replacementAssetId: null,
  rotation: 0,
  sourceId: "Im0",
  sourceIndex: 0,
  type: "pdf-image",
  width: 80,
  x: 72,
  y: 152,
  ...overrides,
});

const page = (image = pdfImage()): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfImageObjects: [image],
  pdfTextObjects: [],
  rotation: 0,
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

afterEach(() => {
  editorStore.clearDocument();
});

test("committing a stale gesture box keeps the store preview", () => {
  editorStore.resetDocument(
    [page(pdfImage({ previewAssetId: "preview-1" }))],
    "demo.pdf"
  );
  editorStore.selectPdfImage("img-1");
  const current = editorStore.selectedPdfImage();
  expect(current).toBeDefined();
  if (!current) {
    return;
  }
  editorStore.commitPdfImage(
    pdfImageWithGestureBox(current, {
      ...current,
      previewAssetId: null,
      x: 90,
      y: 160,
    }),
    true
  );
  const next = editorStore.selectedPdfImage();
  expect(next?.previewAssetId).toBe("preview-1");
  expect(next?.x).toBe(90);
  expect(next?.y).toBe(160);
});

test("moving a PDF image then undo restores the original box", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfImage("img-1");
  editorStore.patchPdfImage((object) => ({ ...object, x: 90, y: 160 }));
  expect(editorStore.selectedPdfImage()?.x).toBe(90);
  editorStore.undo();
  expect(editorStore.selectedPdfImage()?.x).toBe(72);
  expect(editorStore.selectedPdfImage()?.y).toBe(152);
});

test("resize, delete, and replace each record one history entry", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfImage("img-1");
  editorStore.commitPdfImage({ ...pdfImage(), height: 60, width: 120 }, true);
  editorStore.selectPdfImage("img-1");
  editorStore.patchPdfImage((object) => ({
    ...object,
    replacementAssetId: "asset-1",
  }));
  editorStore.selectPdfImage("img-1");
  editorStore.deleteSelected();

  const current = editorStore.getState().document.pages[0]?.pdfImageObjects[0];
  expect(current?.deleted).toBe(true);
  expect(current?.replacementAssetId).toBe("asset-1");
  expect(current?.width).toBe(120);

  editorStore.undo();
  expect(
    editorStore.getState().document.pages[0]?.pdfImageObjects[0]?.deleted
  ).toBe(false);
  editorStore.undo();
  expect(
    editorStore.getState().document.pages[0]?.pdfImageObjects[0]
      ?.replacementAssetId
  ).toBeNull();
  editorStore.undo();
  expect(
    editorStore.getState().document.pages[0]?.pdfImageObjects[0]?.width
  ).toBe(80);
});

test("overlay undo still works after a PDF image edit", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfImage("img-1");
  editorStore.patchPdfImage((object) => ({ ...object, x: 40 }));
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
  expect(editorStore.getState().document.pages[0]?.objects).toHaveLength(1);
  editorStore.undo();
  expect(editorStore.getState().document.pages[0]?.objects).toHaveLength(0);
  expect(editorStore.getState().document.pages[0]?.pdfImageObjects[0]?.x).toBe(
    40
  );
});
