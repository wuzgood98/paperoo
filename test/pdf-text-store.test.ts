import { afterEach, expect, test } from "vitest";

import { isPdfTextDirty } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";

const pdfText = (): PdfTextObject => ({
  color: "#111827",
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 16,
  hasEOL: false,
  height: 16,
  id: "pdf-1",
  originalColor: "#111827",
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
  pdfImageObjects: [],
  pdfTextObjects: [pdfText()],
  pdfVectorObjects: [],
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

test("changing PDF text color marks dirty and undo restores original", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfText("pdf-1");
  editorStore.patchPdfText((object) => ({ ...object, color: "#dc2626" }));
  const after = editorStore.selectedPdfText();
  expect(after?.color).toBe("#dc2626");
  expect(after?.originalColor).toBe("#111827");
  expect(after).toBeDefined();
  if (after) {
    expect(isPdfTextDirty(after)).toBe(true);
  }
  editorStore.undo();
  const restored = editorStore.selectedPdfText();
  expect(restored?.color).toBe("#111827");
  expect(restored).toBeDefined();
  if (restored) {
    expect(isPdfTextDirty(restored)).toBe(false);
  }
});

test("setting the same fontSize or fontFamily does not mark PDF text dirty", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  editorStore.selectPdfText("pdf-1");
  const before = editorStore.selectedPdfText();
  expect(before).toBeDefined();
  if (!before) {
    return;
  }

  editorStore.patchPdfText((object) => {
    if (object.fontSize === 16) {
      return object;
    }
    return { ...object, fontSize: 16 };
  });
  editorStore.patchPdfText((object) => {
    if (object.fontFamily === "sans") {
      return object;
    }
    return { ...object, fontFamily: "sans" };
  });

  const after = editorStore.selectedPdfText();
  expect(after?.fontSize).toBe(16);
  expect(after?.originalFontSize).toBe(16);
  expect(after?.fontFamily).toBe("sans");
  expect(after?.originalFontFamily).toBe("sans");
  expect(after).toBeDefined();
  if (after) {
    expect(isPdfTextDirty(after)).toBe(false);
  }
});
