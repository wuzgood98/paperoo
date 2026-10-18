import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import type { EditorDocument, EditorPage } from "@/lib/editor/types";
import { exportDocument } from "@/lib/pdf/export-pdf";
import { pdfSession } from "@/lib/pdf/session";

import {
  buildPdfAnnotationFixture,
  countPageAnnotSubtypes,
} from "./pdf-annotation-fixture";
import { FORM_FIELD, buildPdfFormFixture } from "./pdf-form-fixture";
import { loadPdfJsDocument } from "./pdfjs-node";

afterEach(async () => {
  await pdfSession.close();
});

const textPdf = async (lines: readonly string[], size: [number, number]) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines) {
    doc
      .addPage(size)
      .drawText(line, { font, size: 18, x: 40, y: size[1] - 80 });
  }
  return new Uint8Array(await doc.save());
};

/** Pages as the editor extracts them; pdf.js keeps its own copy of the bytes. */
const extract = async (bytes: Uint8Array): Promise<EditorPage[]> => {
  const { pages } = await pdfSession.open(Uint8Array.from(bytes));
  return pages;
};

/** A second appearance of `page`, as Duplicate page will make one. */
const repeat = (page: EditorPage, id: string): EditorPage => ({ ...page, id });

const pageTexts = async (bytes: Uint8Array): Promise<string[]> => {
  const task = loadPdfJsDocument(bytes);
  const pdf = await task.promise;
  const texts: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages in order
    const pdfPage = await pdf.getPage(number);
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages in order
    const content = await pdfPage.getTextContent();
    texts.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join("")
    );
  }
  return texts;
};

const run = async (
  bytes: Uint8Array,
  document: EditorDocument,
  sources?: Record<string, Uint8Array>
): Promise<Uint8Array> =>
  await exportDocument({ assets: {}, bytes, document, fontBytes: {}, sources });

test("an edit on a repeated page leaves the other copy's text alone", async () => {
  const bytes = await textPdf(["Original line"], [400, 300]);
  const [page] = await extract(bytes);
  if (!page) {
    throw new Error("fixture has no page");
  }
  const copy = repeat(page, "copy");
  const edited: EditorPage = {
    ...copy,
    pdfTextObjects: copy.pdfTextObjects.map((item) => ({
      ...item,
      text: "Changed line",
    })),
  };

  const output = await run(bytes, { pages: [page, edited] });
  const [first, second] = await pageTexts(output);
  expect(first).toContain("Original line");
  expect(second).toContain("Changed line");
  expect(second).not.toContain("Original line");
});

test("an annotation deleted on a repeated page stays on the other copy", async () => {
  const bytes = await buildPdfAnnotationFixture();
  const [page] = await extract(bytes);
  if (!page) {
    throw new Error("fixture has no page");
  }
  const copy = repeat(page, "copy");
  const withoutHighlight: EditorPage = {
    ...copy,
    pdfAnnotationObjects: copy.pdfAnnotationObjects.map((object) =>
      object.type === "pdf-highlight" ? { ...object, deleted: true } : object
    ),
  };

  const output = await run(bytes, { pages: [page, withoutHighlight] });
  const [original, duplicate] = await Promise.all([
    countPageAnnotSubtypes(output, 0),
    countPageAnnotSubtypes(output, 1),
  ]);
  expect(original.get("Highlight")).toBe(1);
  expect(duplicate.get("Highlight")).toBeUndefined();
});

test("fields whose widgets are all on removed pages leave the form", async () => {
  const bytes = await buildPdfFormFixture();
  const [first] = await extract(bytes);
  if (!first) {
    throw new Error("fixture has no page");
  }

  const output = await run(bytes, { pages: [first] });
  const exported = await PDFDocument.load(output);
  const names = exported
    .getForm()
    .getFields()
    .map((field) => field.getName());
  // Only on page 2: gone. On both pages: kept for its page 1 widget.
  expect(names).not.toContain(FORM_FIELD.rotated);
  expect(names).toContain(FORM_FIELD.shared);
  expect(names).toContain(FORM_FIELD.name);
});

test("pages from another source document export with their own content", async () => {
  const bytes = await textPdf(["Opened file"], [400, 300]);
  const other = await textPdf(["Other file"], [200, 500]);
  const [page] = await extract(bytes);
  if (!page) {
    throw new Error("fixture has no page");
  }
  const otherPage: EditorPage = {
    ...page,
    docId: "other",
    height: 500,
    id: "other-1",
    pdfTextObjects: [],
    sourceIndex: 0,
    width: 200,
  };

  const output = await run(bytes, { pages: [otherPage, page] }, { other });
  const doc = await PDFDocument.load(output);
  expect(doc.getPages().map((item) => item.getSize())).toEqual([
    { height: 500, width: 200 },
    { height: 300, width: 400 },
  ]);
  expect(await pageTexts(output)).toEqual(["Other file", "Opened file"]);
});

test("a page missing from its source fails instead of shifting pages", async () => {
  const bytes = await textPdf(["Only page"], [400, 300]);
  const [page] = await extract(bytes);
  if (!page) {
    throw new Error("fixture has no page");
  }
  await expect(
    run(bytes, { pages: [{ ...page, id: "ghost", sourceIndex: 5 }, page] })
  ).rejects.toThrow("missing from its source PDF");
  await expect(
    run(bytes, { pages: [{ ...page, docId: "absent" }] })
  ).rejects.toThrow("source PDF is missing");
});
