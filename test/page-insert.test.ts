import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { duplicatePage, insertBlankPageAfter } from "@/lib/editor/page-actions";
import { clonePageWithFreshIds } from "@/lib/editor/page-clone";
import { pageDocId } from "@/lib/editor/page-source";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, TextObject } from "@/lib/editor/types";
import { ocrSession } from "@/lib/ocr/session";
import type { OcrTextObject } from "@/lib/ocr/types";
import { blankDocId, blankDocSize, blankPdfBytes } from "@/lib/pdf/blank-pdf";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { pdfSession } from "@/lib/pdf/session";

import { FORM_FIELD, buildPdfFormFixture } from "./pdf-form-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

afterEach(async () => {
  await Promise.all([pdfSession.close(), ocrSession.reset()]);
  editorStore.clearDocument();
});

const textPdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 300]).drawText("First", { font, size: 18, x: 40, y: 200 });
  doc.addPage([400, 300]).drawText("Second", { font, size: 18, x: 40, y: 200 });
  return new Uint8Array(await doc.save());
};

/** Open `bytes` the way the editor does, fully loaded. */
const openInEditor = async (bytes: Uint8Array): Promise<EditorPage[]> => {
  const { form, pages } = await pdfSession.open(Uint8Array.from(bytes));
  editorStore.resetDocument(pages, "doc.pdf", form);
  editorStore.markHydrated();
  return editorStore.getState().document.pages;
};

const pageIds = (): string[] =>
  editorStore.getState().document.pages.map((page) => page.id);

test("the blank PDF parses in pdf.js and pdf-lib at the asked size", async () => {
  const bytes = blankPdfBytes(612, 792.5);
  const pdf = await loadPdfJsDocument(bytes).promise;
  const page = await pdf.getPage(1);
  expect(page.view).toEqual([0, 0, 612, 792.5]);
  const operators = await page.getOperatorList();
  expect(operators.fnArray.length).toBeLessThanOrEqual(2);
  const parsed = await PDFDocument.load(bytes);
  expect(parsed.getPage(0).getSize()).toEqual({ height: 792.5, width: 612 });

  expect(blankDocId(612.004, 792.5)).toBe("blank:612x792.5");
  expect(blankDocSize("blank:612x792.5")).toEqual({
    height: 792.5,
    width: 612,
  });
  expect(blankDocSize("primary")).toBeNull();
});

test("a cloned page and everything on it get new ids", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const source = doc.addPage([400, 300]);
  source.drawText("Label", { font, size: 18, x: 40, y: 200 });
  source.drawRectangle({
    color: rgb(0, 0, 1),
    height: 40,
    width: 80,
    x: 40,
    y: 60,
  });
  const [page] = await openInEditor(new Uint8Array(await doc.save()));
  const [run] = page?.pdfTextObjects ?? [];
  const [vector] = page?.pdfVectorObjects ?? [];
  if (!(page && run && vector)) {
    throw new Error("fixture needs a run and a vector");
  }
  const ocrText: TextObject = {
    align: "left",
    color: "#111827",
    content: "word",
    fontFamily: "sans",
    fontSize: 16,
    fontWeight: 400,
    height: 28,
    id: "t1",
    italic: false,
    ocrWordId: "w1",
    opacity: 1,
    rotation: 0,
    source: "overlay",
    type: "text",
    width: 120,
    x: 40,
    y: 40,
  };
  const linked: EditorPage = {
    ...page,
    objects: [ocrText],
    pdfTextObjects: [
      {
        ...run,
        glyphFace: { pageId: page.id, showOrdinal: 2 },
        inkVectorId: vector.id,
      },
    ],
    suppressedOcrWordIds: ["w1", "w2"],
  };

  const copy = clonePageWithFreshIds(linked, {
    ocrWordIds: new Map([["w1", "w1-copy"]]),
    pageId: "p2",
  });
  expect(copy.id).toBe("p2");
  expect(copy.sourceIndex).toBe(page.sourceIndex);
  expect(copy.omitFormWidgets).toBe(true);
  const [copiedVector] = copy.pdfVectorObjects;
  const [copiedRun] = copy.pdfTextObjects;
  const [copiedText] = copy.objects;
  expect(copiedVector?.id).not.toBe(vector.id);
  expect(copiedVector?.pageId).toBe("p2");
  expect(copiedRun?.id).not.toBe(run.id);
  expect(copiedRun?.pageId).toBe("p2");
  expect(copiedRun?.inkVectorId).toBe(copiedVector?.id);
  expect(copiedRun?.glyphFace?.pageId).toBe("p2");
  expect(copiedText?.id).not.toBe("t1");
  expect(copiedText?.type === "text" && copiedText.ocrWordId).toBe("w1-copy");
  expect(copy.suppressedOcrWordIds).toEqual(["w1-copy"]);
});

test("duplicating a page inserts a copy after it as one undo step", async () => {
  const [first, second] = await openInEditor(await textPdf());
  if (!(first && second)) {
    throw new Error("expected two pages");
  }
  const word: OcrTextObject = {
    baselineY: 10,
    height: 10,
    id: "w1",
    lineId: "l1",
    pageId: first.id,
    source: "ocr",
    text: "First",
    type: "ocr-text",
    width: 40,
    x: 40,
    y: 90,
  };
  ocrSession.hydrate({ [first.id]: [word] });

  expect(duplicatePage(first.id)).toBe(true);
  const ids = pageIds();
  expect(ids).toHaveLength(3);
  expect(ids[0]).toBe(first.id);
  expect(ids[2]).toBe(second.id);
  const copyId = ids[1] ?? "";
  expect(editorStore.getState().currentPageId).toBe(copyId);
  const copiedWords = ocrSession.getState().wordsByPage[copyId];
  expect(copiedWords?.map((item) => item.text)).toEqual(["First"]);
  expect(copiedWords?.[0]?.id).not.toBe("w1");

  editorStore.undo();
  expect(pageIds()).toEqual([first.id, second.id]);
});

test("pages are not inserted before every page has loaded", async () => {
  const { pages } = await pdfSession.open(await textPdf());
  editorStore.resetDocument(pages, "doc.pdf");
  const [first] = pages;
  expect(duplicatePage(first?.id ?? "")).toBe(false);
  expect(await insertBlankPageAfter(first?.id ?? "")).toBe(false);
  expect(pageIds()).toHaveLength(2);
});

test("a blank page matches the page it follows, rotation included", async () => {
  const [first] = await openInEditor(await textPdf());
  if (!first) {
    throw new Error("expected a page");
  }
  editorStore.rotateCurrentPage(90);
  expect(await insertBlankPageAfter(first.id)).toBe(true);
  const [, blank] = editorStore.getState().document.pages;
  expect(blank && pageDocId(blank)).toBe("blank:300x400");
  expect(blank && [blank.width, blank.height]).toEqual([300, 400]);
  expect(blank?.pdfTextObjects).toEqual([]);

  // A second page of that size reuses the open blank source.
  expect(await insertBlankPageAfter(first.id)).toBe(true);
  expect(pdfSession.docIds()).toEqual(["primary", "blank:300x400"]);
});

test("blank and duplicated pages export; the duplicate has no form fields", async () => {
  const bytes = await buildPdfFormFixture();
  const [first] = await openInEditor(bytes);
  if (!first) {
    throw new Error("expected a page");
  }
  expect(duplicatePage(first.id)).toBe(true);
  expect(await insertBlankPageAfter(first.id)).toBe(true);
  const { document } = editorStore.getState();
  const blankId = blankDocId(first.width, first.height);
  const blankBytes = pdfSession.bytesOf(blankId);
  if (!blankBytes) {
    throw new Error("blank source is not open");
  }

  const output = await exportDocument({
    assets: {},
    bytes,
    document,
    fontBytes: {},
    sources: { [blankId]: blankBytes },
  });
  const exported = await PDFDocument.load(output);
  expect(exported.getPageCount()).toBe(4);
  const widgetsOn = (index: number): number =>
    (exported.getPage(index).node.Annots()?.asArray() ?? []).filter((entry) => {
      const dict = exported.context.lookup(entry);
      return (
        dict instanceof PDFDict &&
        dict.get(PDFName.of("Subtype")) === PDFName.of("Widget")
      );
    }).length;
  // Order: original, blank (inserted right after it), duplicate, page 2.
  expect(document.pages.map((page) => page.omitFormWidgets === true)).toEqual([
    false,
    false,
    true,
    false,
  ]);
  expect(widgetsOn(0)).toBeGreaterThan(0);
  expect(widgetsOn(2)).toBe(0);
  const names = exported
    .getForm()
    .getFields()
    .map((field) => field.getName());
  expect(names).toContain(FORM_FIELD.name);
  expect(names).toContain(FORM_FIELD.rotated);
});
