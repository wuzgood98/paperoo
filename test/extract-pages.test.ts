import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { pageRangeLabel } from "@/lib/editor/page-range";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { pdfSession } from "@/lib/pdf/session";

import { FORM_FIELD, buildPdfFormFixture } from "./pdf-form-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

afterEach(async () => {
  await pdfSession.close();
  editorStore.clearDocument();
});

/** Pages labelled "Page 1"…; page 1 links to the last page. */
const labelledPdf = async (count: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: count }, (_, index) => {
    const page = doc.addPage([300, 300]);
    page.drawText(`Page ${index + 1}`, { font, size: 18, x: 40, y: 200 });
    return page;
  });
  const [first] = pages;
  const last = pages.at(-1);
  if (first && last) {
    const link = doc.context.register(
      doc.context.obj({
        Dest: [last.ref, PDFName.of("Fit")],
        Rect: [10, 10, 110, 40],
        Subtype: "Link",
        Type: "Annot",
      })
    );
    first.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  }
  return new Uint8Array(await doc.save());
};

const extract = async (bytes: Uint8Array): Promise<EditorPage[]> => {
  const { pages } = await pdfSession.open(Uint8Array.from(bytes));
  return pages;
};

const pageTexts = async (bytes: Uint8Array): Promise<string[]> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const texts: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages in order
    const page = await pdf.getPage(number);
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages in order
    const content = await page.getTextContent();
    texts.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join("")
    );
  }
  return texts;
};

const linkDest = async (bytes: Uint8Array): Promise<boolean> => {
  const doc = await PDFDocument.load(bytes);
  const [link] = doc.getPage(0).node.Annots()?.asArray() ?? [];
  const dict = link ? doc.context.lookup(link) : undefined;
  return dict instanceof PDFDict && dict.has(PDFName.of("Dest"));
};

test("extracting writes only the chosen pages, in document order", async () => {
  const bytes = await labelledPdf(4);
  const pages = await extract(bytes);
  const ids = pages.map((page) => page.id);
  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages },
    fontBytes: {},
    pageIds: [ids[3] ?? "", ids[0] ?? ""],
  });
  expect(await pageTexts(output)).toEqual(["Page 1", "Page 4"]);
  // Page 1's link to page 4 still has its target.
  expect(await linkDest(output)).toBe(true);
});

test("a link to a page left out loses its destination", async () => {
  const bytes = await labelledPdf(3);
  const pages = await extract(bytes);
  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages },
    fontBytes: {},
    pageIds: [pages[0]?.id ?? ""],
  });
  expect(await pageTexts(output)).toEqual(["Page 1"]);
  expect(await linkDest(output)).toBe(false);
  // Only the chosen page is in the output.
  const exported = await PDFDocument.load(output);
  expect(exported.getPageCount()).toBe(1);
});

test("form fields only on left-out pages are not extracted", async () => {
  const bytes = await buildPdfFormFixture();
  const pages = await extract(bytes);
  const output = await exportDocument({
    assets: {},
    bytes,
    document: { pages },
    fontBytes: {},
    pageIds: [pages[1]?.id ?? ""],
  });
  const exported = await PDFDocument.load(output);
  const names = exported
    .getForm()
    .getFields()
    .map((field) => field.getName());
  expect(names).toContain(FORM_FIELD.rotated);
  expect(names).toContain(FORM_FIELD.shared);
  expect(names).not.toContain(FORM_FIELD.name);
});

test("an extract with no pages is refused", async () => {
  const bytes = await labelledPdf(2);
  const pages = await extract(bytes);
  await expect(
    exportDocument({
      assets: {},
      bytes,
      document: { pages },
      fontBytes: {},
      pageIds: ["missing"],
    })
  ).rejects.toThrow("at least one page");
});

test("page selection: toggle, range, and pruning on delete and undo", async () => {
  const pages = await extract(await labelledPdf(5));
  editorStore.resetDocument(pages, "doc.pdf");
  const ids = pages.map((page) => page.id);
  const [a = "", b = "", c = "", d = "", e = ""] = ids;

  editorStore.togglePageSelection(b);
  editorStore.selectPageRange(d);
  expect(editorStore.getState().selectedPageIds).toEqual([b, c, d]);
  editorStore.togglePageSelection(c);
  expect(editorStore.getState().selectedPageIds).toEqual([b, d]);

  editorStore.rotatePages([b, d], 90);
  const rotations = editorStore
    .getState()
    .document.pages.map((page) => page.rotation);
  expect(rotations).toEqual([0, 90, 0, 90, 0]);
  editorStore.undo();

  expect(editorStore.deletePages([b, d])).toBe(true);
  expect(editorStore.getState().document.pages.map((page) => page.id)).toEqual([
    a,
    c,
    e,
  ]);
  expect(editorStore.getState().selectedPageIds).toEqual([]);
  editorStore.undo();
  expect(editorStore.getState().document.pages).toHaveLength(5);
  expect(editorStore.deletePages(ids)).toBe(false);

  editorStore.togglePageSelection(a);
  editorStore.clearPageSelection();
  expect(editorStore.getState().selectedPageIds).toEqual([]);
});

test("extract file names list pages as ranges", () => {
  expect(pageRangeLabel([1, 2, 3, 5])).toBe("1-3,5");
  expect(pageRangeLabel([7])).toBe("7");
  expect(pageRangeLabel([4, 2, 3, 3, 9, 10])).toBe("2-4,9-10");
});
