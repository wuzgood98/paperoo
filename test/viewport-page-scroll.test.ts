import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";

const page = (id: string, width = 612, height = 792): EditorPage => ({
  cropBox: { height, width, x: 0, y: 0 },
  height,
  id,
  objects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  sourceIndex: 0,
  sourceRotate: 0,
  width,
});

afterEach(() => {
  editorStore.clearDocument();
});

test("setCurrentPage syncFitZoom false skips recompute under fit-page", () => {
  editorStore.resetDocument(
    [page("a", 612, 792), page("b", 400, 1200)],
    "demo.pdf"
  );
  editorStore.setViewportSize({ height: 800, width: 800 });
  editorStore.fitPage();
  const zoomBefore = editorStore.getState().zoom;

  editorStore.setCurrentPage("b", { syncFitZoom: false });

  expect(editorStore.getState().currentPageId).toBe("b");
  expect(editorStore.getState().zoom).toBe(zoomBefore);
  expect(editorStore.getState().zoomMode).toBe("fit-page");
});

test("setCurrentPage syncFitZoom true recomputes under fit-page", () => {
  editorStore.resetDocument(
    [page("a", 612, 792), page("b", 400, 1200)],
    "demo.pdf"
  );
  editorStore.setViewportSize({ height: 800, width: 800 });
  editorStore.fitPage();
  const zoomBefore = editorStore.getState().zoom;

  editorStore.setCurrentPage("b");

  expect(editorStore.getState().currentPageId).toBe("b");
  expect(editorStore.getState().zoom).not.toBe(zoomBefore);
  expect(editorStore.getState().zoomMode).toBe("fit-page");
});

test("stepCurrentPage moves to adjacent pages", () => {
  editorStore.resetDocument([page("a"), page("b"), page("c")], "demo.pdf");

  expect(editorStore.getState().currentPageId).toBe("a");
  editorStore.stepCurrentPage(1);
  expect(editorStore.getState().currentPageId).toBe("b");
  editorStore.stepCurrentPage(1);
  expect(editorStore.getState().currentPageId).toBe("c");
  editorStore.stepCurrentPage(-1);
  expect(editorStore.getState().currentPageId).toBe("b");
});

test("stepCurrentPage no-ops at first and last page", () => {
  editorStore.resetDocument([page("a"), page("b")], "demo.pdf");

  editorStore.stepCurrentPage(-1);
  expect(editorStore.getState().currentPageId).toBe("a");

  editorStore.setCurrentPage("b", { syncFitZoom: false });
  editorStore.stepCurrentPage(1);
  expect(editorStore.getState().currentPageId).toBe("b");
});

test("stepCurrentPage keeps zoom under fit-page", () => {
  editorStore.resetDocument(
    [page("a", 612, 792), page("b", 400, 1200)],
    "demo.pdf"
  );
  editorStore.setViewportSize({ height: 800, width: 800 });
  editorStore.fitPage();
  const zoomBefore = editorStore.getState().zoom;

  editorStore.stepCurrentPage(1);

  expect(editorStore.getState().currentPageId).toBe("b");
  expect(editorStore.getState().zoom).toBe(zoomBefore);
  expect(editorStore.getState().zoomMode).toBe("fit-page");
});
