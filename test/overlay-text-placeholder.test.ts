import { PDFDocument } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { roundFontSize } from "@/components/editor/utils";
import { createTextObject } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, TextObject } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";

import { loadPdfJsDocument } from "./pdfjs-node";

const page = (objects: EditorPage["objects"] = []): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects,
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

const objectIds = (): string[] =>
  editorStore.getState().document.pages[0]?.objects.map(({ id }) => id) ?? [];

afterEach(() => {
  editorStore.clearDocument();
});

test("the text tool places an empty box", () => {
  expect(createTextObject({ x: 10, y: 10 }).content).toBe("");
});

test("discarding an untouched box also drops its add from history", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  const box = createTextObject({ x: 10, y: 10 });
  editorStore.addObject(box);
  expect(editorStore.canUndo()).toBe(true);

  editorStore.discardEmptyText(box.id);

  expect(objectIds()).toEqual([]);
  expect(editorStore.canUndo()).toBe(false);
});

test("discarding a box edited since it was added is its own undo step", () => {
  editorStore.resetDocument([page()], "demo.pdf");
  const box = createTextObject({ x: 10, y: 10 });
  editorStore.addObject(box);
  editorStore.commitObject(box.id, { ...box, x: 50 }, true);

  editorStore.discardEmptyText(box.id);
  expect(objectIds()).toEqual([]);

  editorStore.undo();
  expect(objectIds()).toEqual([box.id]);
});

test("export skips blank text boxes and keeps written ones", async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = await source.save();
  const blank = createTextObject({ x: 40, y: 40 });
  const written: TextObject = {
    ...createTextObject({ x: 40, y: 120 }),
    content: "Hello",
  };

  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages: [page([blank, written])] },
    fontBytes: {},
  });

  const pdf = await loadPdfJsDocument(output).promise;
  const exportedPage = await pdf.getPage(1);
  const content = await exportedPage.getTextContent();
  const strings = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .filter((text) => text.trim() !== "");
  expect(strings).toEqual(["Hello"]);
});

test("inspector font size shows two decimals", () => {
  expect(roundFontSize(18.604825)).toBe(18.6);
  expect(roundFontSize(10.448)).toBe(10.45);
  expect(roundFontSize(12)).toBe(12);
});
