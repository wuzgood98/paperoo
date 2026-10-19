import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { documentForm } from "@/lib/editor/object-utils";
import { pageDocId } from "@/lib/editor/page-source";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfFormField } from "@/lib/editor/types";
import { MAX_PDF_PAGES, PRIMARY_DOC_ID } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { FILE_DOC_PREFIX, insertPdfBytes } from "@/lib/pdf/insert-pdf";
import { pdfSession } from "@/lib/pdf/session";

import { FORM_FIELD, buildPdfFormFixture } from "./pdf-form-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

afterEach(async () => {
  await pdfSession.close();
  editorStore.clearDocument();
});

const textPdf = async (labels: readonly string[]): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    doc.addPage([300, 300]).drawText(label, { font, size: 18, x: 40, y: 200 });
  }
  return new Uint8Array(await doc.save());
};

/** Open `bytes` the way the editor does, fully loaded. */
const openInEditor = async (bytes: Uint8Array): Promise<void> => {
  const { form, pages } = await pdfSession.open(Uint8Array.from(bytes));
  editorStore.resetDocument(pages, "doc.pdf", form);
  editorStore.markHydrated();
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

/** Export the editor's document with every source it uses. */
const exportEditor = async (opened: Uint8Array): Promise<Uint8Array> => {
  const { document } = editorStore.getState();
  const sources: Record<string, Uint8Array> = {};
  for (const page of document.pages) {
    const docId = pageDocId(page);
    const bytes = pdfSession.bytesOf(docId);
    if (docId !== PRIMARY_DOC_ID && bytes) {
      sources[docId] = bytes;
    }
  }
  return await exportDocument({
    assets: {},
    bytes: opened,
    document,
    fontBytes: {},
    sources,
  });
};

test("another PDF's pages go in at the index, as one undo step", async () => {
  await openInEditor(await textPdf(["A1", "A2"]));
  const before = editorStore.getState().document.pages.map((page) => page.id);

  expect(await insertPdfBytes(await textPdf(["B1", "B2"]), 1)).toBe(2);
  const { pages } = editorStore.getState().document;
  expect(pages).toHaveLength(4);
  const [, firstInserted] = pages;
  expect(firstInserted && pageDocId(firstInserted)).toMatch(
    new RegExp(`^${FILE_DOC_PREFIX}`, "u")
  );
  expect(editorStore.getState().currentPageId).toBe(firstInserted?.id);

  editorStore.undo();
  expect(editorStore.getState().document.pages.map((page) => page.id)).toEqual(
    before
  );
});

test("inserted pages export in place, from their own PDF", async () => {
  const opened = await textPdf(["A1", "A2"]);
  await openInEditor(opened);
  await insertPdfBytes(await textPdf(["B1", "B2"]), 1);
  expect(await pageTexts(await exportEditor(opened))).toEqual([
    "A1",
    "B1",
    "B2",
    "A2",
  ]);
});

test("two forms merge: clashing names are renamed, values stay per source", async () => {
  const opened = await buildPdfFormFixture();
  await openInEditor(opened);
  await insertPdfBytes(await buildPdfFormFixture(), 2);

  const { fields } = documentForm(editorStore.getState().document);
  const names = fields.filter((field) => field.name === FORM_FIELD.name);
  expect(names.map((field) => field.docId === undefined)).toEqual([
    true,
    false,
  ]);
  const [, insertedName] = names;
  if (insertedName?.kind !== "text") {
    throw new Error("expected the inserted name field");
  }
  editorStore.setDocumentForm({
    ...documentForm(editorStore.getState().document),
    fields: fields.map((field): PdfFormField =>
      field.id === insertedName.id ? { ...insertedName, value: "Ama" } : field
    ),
  });

  const exported = await PDFDocument.load(await exportEditor(opened));
  const form = exported.getForm();
  expect(form.getTextField(FORM_FIELD.name).getText()).toBe("Gideon");
  // "person.name" is the kid "name" of the top-level field "person"; the
  // clashing top-level name is the one renamed.
  expect(form.getTextField("person_2.name").getText()).toBe("Ama");
  expect(exported.getPageCount()).toBe(4);
});

test("files that are not PDFs, too large in pages, or too many are refused", async () => {
  await openInEditor(await textPdf(["A1"]));
  await expect(insertPdfBytes(new Uint8Array([1, 2, 3]), 0)).rejects.toThrow(
    "valid PDF"
  );

  // A document already at the page limit takes no more pages.
  const [page] = editorStore.getState().document.pages;
  if (!page) {
    throw new Error("expected a page");
  }
  const full: EditorPage[] = Array.from(
    { length: MAX_PDF_PAGES },
    (_, index) => ({
      ...page,
      id: `p${index}`,
    })
  );
  editorStore.resetDocument(full, "doc.pdf");
  editorStore.markHydrated();
  await expect(insertPdfBytes(await textPdf(["B1"]), 0)).rejects.toThrow(
    `at most ${MAX_PDF_PAGES} pages`
  );
  // The refused PDF does not stay open.
  expect(pdfSession.docIds()).toEqual([PRIMARY_DOC_ID]);
});

test("nothing is inserted before every page has loaded", async () => {
  const { pages } = await pdfSession.open(await textPdf(["A1"]));
  editorStore.resetDocument(pages, "doc.pdf");
  await expect(insertPdfBytes(await textPdf(["B1"]), 0)).rejects.toThrow(
    "Wait for every page"
  );
});
