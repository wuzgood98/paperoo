import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";

const pdfText = (): PdfTextObject => ({
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 16,
  hasEOL: false,
  height: 16,
  id: "pdf-1",
  originalFontFamily: "sans",
  originalFontSize: 16,
  originalText: "Hello",
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  text: "Hello",
  transform: [16, 0, 0, 16, 72, 700],
  type: "pdf-text",
  width: 40,
  x: 72,
  y: 76,
});

const page = (): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfTextObjects: [pdfText()],
  rotation: 0,
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

afterEach(() => {
  editorStore.clearDocument();
});

test("editing PDF text then undo restores the original string", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfText("pdf-1");
  editorStore.patchPdfText((object) => ({ ...object, text: "Hello World" }));
  expect(editorStore.selectedPdfText()?.text).toBe("Hello World");
  editorStore.undo();
  expect(editorStore.selectedPdfText()?.text).toBe("Hello");
  expect(editorStore.selectedPdfText()?.originalText).toBe("Hello");
});

test("overlay undo still works after a PDF text edit", () => {
  editorStore.resetDocument([page()], "demo.pdf");
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
});
