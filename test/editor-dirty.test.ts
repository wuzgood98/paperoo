import { afterEach, expect, test } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject, TextObject } from "@/lib/editor/types";
import { EMPTY_PDF_FORM } from "@/lib/editor/types";

const run = (id: string): PdfTextObject => ({
  baseFontName: "ABCDEF+TestSans",
  color: "#111827",
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 16,
  hasEOL: false,
  height: 16,
  id,
  originalColor: "#111827",
  originalFontFamily: "sans",
  originalFontSize: 16,
  originalStrokeColor: "#000000",
  originalStrokeWidth: 1,
  originalText: "Hello",
  originalTextRenderingMode: 0,
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  strokeColor: "#000000",
  strokeWidth: 1,
  text: "Hello",
  textRenderingMode: 0,
  transform: [16, 0, 0, 16, 72, 700],
  type: "pdf-text",
  width: 40,
  x: 72,
  y: 76,
});

const page = (id: string, sourceIndex: number): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id,
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: id === "page-1" ? [run("pdf-1")] : [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex,
  sourceRotate: 0,
  width: 612,
});

const text = (id: string, content = "Overlay"): TextObject => ({
  align: "left",
  color: "#111827",
  content,
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 28,
  id,
  italic: false,
  opacity: 1,
  rotation: 0,
  source: "overlay",
  type: "text",
  width: 120,
  x: 40,
  y: 40,
});

const measure = (): void => {
  editorStore.applyPdfTextMeasurement("page-1", "pdf-1", {
    coverColor: "#ffffff",
    coverColorUncertain: false,
    coverRects: [],
    reusableFontGlyphs: "Helo",
  });
};

afterEach(() => {
  editorStore.clearDocument();
});

test("a freshly opened document has no unsaved edits", () => {
  expect(editorStore.isDirty()).toBe(false);
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  expect(editorStore.isDirty()).toBe(false);
});

test("edits are unsaved until undone, and again after redo", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1"));
  expect(editorStore.isDirty()).toBe(true);
  editorStore.undo();
  expect(editorStore.isDirty()).toBe(false);
  editorStore.redo();
  expect(editorStore.isDirty()).toBe(true);
});

test("facts about the source PDF keep a saved document saved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.appendPages([page("page-2", 1)]);
  editorStore.setDocumentForm(EMPTY_PDF_FORM);
  measure();
  expect(editorStore.getState().document.pages).toHaveLength(2);
  expect(editorStore.isDirty()).toBe(false);
});

test("facts keep an edited document unsaved, and undo still reaches saved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1"));
  editorStore.appendPages([page("page-2", 1)]);
  measure();
  expect(editorStore.isDirty()).toBe(true);
  editorStore.undo();
  expect(editorStore.getState().document.pages).toHaveLength(2);
  expect(editorStore.isDirty()).toBe(false);
});

test("markClean saves the document; later edits are unsaved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1"));
  editorStore.markClean();
  expect(editorStore.isDirty()).toBe(false);
  editorStore.patchSelected((object) => ({ ...object, x: 80 }));
  expect(editorStore.isDirty()).toBe(true);
  editorStore.undo();
  expect(editorStore.isDirty()).toBe(false);
});

test("markClean with an older document leaves newer edits unsaved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1"));
  const exported = editorStore.getState().document;
  editorStore.patchSelected((object) => ({ ...object, x: 80 }));
  editorStore.markClean(exported);
  expect(editorStore.isDirty()).toBe(true);
  editorStore.undo();
  expect(editorStore.isDirty()).toBe(false);
});

test("discarding an empty text box leaves the document saved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1", ""));
  expect(editorStore.isDirty()).toBe(true);
  editorStore.discardEmptyText("overlay-1");
  expect(editorStore.isDirty()).toBe(false);
});

test("a preview that returns to the saved values is saved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1"));
  editorStore.markClean();
  editorStore.previewEdit(() =>
    editorStore.patchSelected((object) => ({ ...object, opacity: 0.5 }))
  );
  expect(editorStore.isDirty()).toBe(true);
  editorStore.commitPreview();
  editorStore.undo();
  expect(editorStore.isDirty()).toBe(false);
});

test("a cleared document has nothing unsaved", () => {
  editorStore.resetDocument([page("page-1", 0)], "demo.pdf");
  editorStore.addObject(text("overlay-1"));
  editorStore.clearDocument();
  expect(editorStore.isDirty()).toBe(false);
});
