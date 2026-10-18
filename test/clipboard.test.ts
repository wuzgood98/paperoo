import { afterEach, expect, test, vi } from "vitest";

import {
  PASTE_OFFSET,
  clearClipboard,
  copySelection,
  createPastedTextObject,
  duplicateSelection,
  fitImageToPage,
  pasteClipboard,
  prepareObjectsForPaste,
} from "@/lib/editor/clipboard";
import { shouldHandleClipboardEvent } from "@/lib/editor/clipboard-gate";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorObject,
  EditorPage,
  ImageObject,
  ShapeObject,
  TextObject,
} from "@/lib/editor/types";
import { DEFAULT_TEXT_STYLE } from "@/lib/editor/types";

const page = (id: string, width = 612, height = 792): EditorPage => ({
  cropBox: { height, width, x: 0, y: 0 },
  height,
  id,
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width,
});

const text = (id: string, content: string, x = 40, y = 40): TextObject => ({
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
  x,
  y,
});

const shape = (id: string): ShapeObject => ({
  fill: null,
  height: 50,
  id,
  opacity: 1,
  rotation: 0,
  shape: "rect",
  source: "overlay",
  stroke: "#111827",
  strokeWidth: 2,
  type: "shape",
  width: 80,
  x: 100,
  y: 100,
});

const objectsOn = (pageId: string): EditorObject[] =>
  editorStore.getState().document.pages.find((item) => item.id === pageId)
    ?.objects ?? [];

const openWith = (...objects: EditorObject[]): void => {
  editorStore.resetDocument(
    [page("page-1"), page("page-2", 300, 200)],
    "a.pdf"
  );
  for (const object of objects) {
    editorStore.addObject(object);
  }
};

afterEach(() => {
  clearClipboard();
  editorStore.clearDocument();
  vi.unstubAllGlobals();
});

test("pasted objects get fresh ids and keep their stacking order", () => {
  openWith(text("t1", "Top"), shape("s1"));
  editorStore.selectObjects(["s1", "t1"]);
  expect(copySelection()?.text).toBe("Top");
  expect(pasteClipboard()).toBe(true);

  const objects = objectsOn("page-1");
  expect(objects).toHaveLength(4);
  const pasted = objects.slice(2);
  expect(pasted.map((object) => object.type)).toEqual(["text", "shape"]);
  expect(pasted.map((object) => object.id)).not.toContain("t1");
  expect(new Set(objects.map((object) => object.id)).size).toBe(4);
  expect(editorStore.getState().selectedObjectIds).toEqual(
    pasted.map((object) => object.id)
  );
});

test("repeated pastes onto the source page step further each time", () => {
  openWith(text("t1", "Hi"));
  editorStore.selectObjects(["t1"]);
  copySelection();
  pasteClipboard();
  pasteClipboard();
  const xs = objectsOn("page-1").map((object) => object.x);
  expect(xs).toEqual([40, 40 + PASTE_OFFSET, 40 + 2 * PASTE_OFFSET]);
});

test("a paste onto another page keeps the position, kept inside the page", () => {
  openWith(text("t1", "Far", 500, 700));
  editorStore.selectObjects(["t1"]);
  copySelection();
  editorStore.setCurrentPage("page-2");
  pasteClipboard();
  const [pasted] = objectsOn("page-2");
  expect(pasted?.x).toBe(300 - 120);
  expect(pasted?.y).toBe(200 - 28);
});

test("a paste is one undo step", () => {
  openWith(text("t1", "Hi"), shape("s1"));
  editorStore.selectObjects(["t1", "s1"]);
  copySelection();
  pasteClipboard();
  expect(objectsOn("page-1")).toHaveLength(4);
  editorStore.undo();
  expect(objectsOn("page-1")).toHaveLength(2);
});

test("duplicate offsets the selection and leaves the clipboard alone", () => {
  openWith(text("t1", "Copied"), shape("s1"));
  editorStore.selectObjects(["t1"]);
  copySelection();
  editorStore.selectObjects(["s1"]);
  expect(duplicateSelection()).toBe(true);
  const duplicate = objectsOn("page-1").at(-1);
  expect(duplicate?.type).toBe("shape");
  expect(duplicate?.x).toBe(100 + PASTE_OFFSET);

  pasteClipboard();
  expect(objectsOn("page-1").at(-1)?.type).toBe("text");
});

test("a copy of recognized text is plain text", () => {
  const [copy] = prepareObjectsForPaste(
    [{ ...text("t1", "OCR"), ocrWordId: "word-1" }],
    page("page-1"),
    0
  );
  expect(copy?.type).toBe("text");
  expect(copy && "ocrWordId" in copy).toBe(false);
});

test("pasted images reuse their asset, or add it back after a new file", () => {
  openWith();
  const asset = editorStore.addAsset(new Uint8Array([1, 2, 3]), "image/png");
  const image: ImageObject = {
    assetId: asset.id,
    height: 10,
    id: "i1",
    mimeType: "image/png",
    opacity: 1,
    rotation: 0,
    source: "overlay",
    type: "image",
    width: 10,
    x: 0,
    y: 0,
  };
  editorStore.addObject(image);
  copySelection();
  pasteClipboard();
  const [, reused] = objectsOn("page-1");
  expect(reused?.type === "image" && reused.assetId).toBe(asset.id);

  // A new document revokes every asset; the clipboard still has the bytes.
  editorStore.resetDocument([page("page-9")], "b.pdf");
  pasteClipboard();
  const [readded] = objectsOn("page-9");
  expect(readded?.type).toBe("image");
  const readdedId = readded?.type === "image" ? readded.assetId : "";
  expect(readdedId).not.toBe(asset.id);
  expect([...(editorStore.getAsset(readdedId)?.bytes ?? [])]).toEqual([
    1, 2, 3,
  ]);
});

test("nothing to copy or duplicate without a selection", () => {
  openWith(text("t1", "Hi"));
  editorStore.clearSelection();
  expect(copySelection()).toBeNull();
  expect(duplicateSelection()).toBe(false);
  expect(pasteClipboard()).toBe(false);
});

test("pasted text wraps inside the page and centers", () => {
  const object = createPastedTextObject(
    "word ".repeat(200).trim(),
    DEFAULT_TEXT_STYLE,
    page("page-1")
  );
  expect(object.width).toBeLessThanOrEqual(612 * 0.6);
  expect(object.height).toBeGreaterThan(DEFAULT_TEXT_STYLE.fontSize * 1.2);
  expect(object.x).toBeCloseTo((612 - object.width) / 2);
});

test("images start at most 40% of the page width and never grow", () => {
  expect(fitImageToPage({ height: 500, width: 1000 }, 600)).toEqual({
    height: 120,
    width: 240,
  });
  expect(fitImageToPage({ height: 20, width: 40 }, 600)).toEqual({
    height: 20,
    width: 40,
  });
});

class FakeElement extends EventTarget {
  readonly isContentEditable: boolean;
  readonly tagName: string;
  readonly #inPopup: boolean;

  // Inputs here are all text inputs.
  readonly #type: string | null = null;

  constructor(tagName: string, editable = false, inPopup = false) {
    super();
    this.tagName = tagName;
    this.isContentEditable = editable;
    this.#inPopup = inPopup;
  }

  closest(): FakeElement | null {
    return this.#inPopup ? this : null;
  }

  getAttribute(): string | null {
    return this.#type;
  }
}

test("text fields, text selections and dialogs keep the browser's clipboard", () => {
  vi.stubGlobal("HTMLElement", FakeElement);
  const collapsed = { isCollapsed: true, rangeCount: 1 };
  expect(shouldHandleClipboardEvent(new FakeElement("DIV"), collapsed)).toBe(
    true
  );
  expect(shouldHandleClipboardEvent(new FakeElement("INPUT"), collapsed)).toBe(
    false
  );
  expect(
    shouldHandleClipboardEvent(new FakeElement("TEXTAREA"), collapsed)
  ).toBe(false);
  expect(
    shouldHandleClipboardEvent(new FakeElement("DIV", true), collapsed)
  ).toBe(false);
  expect(
    shouldHandleClipboardEvent(new FakeElement("DIV", false, true), collapsed)
  ).toBe(false);
  expect(
    shouldHandleClipboardEvent(new FakeElement("DIV"), {
      isCollapsed: false,
      rangeCount: 1,
    })
  ).toBe(false);
});
