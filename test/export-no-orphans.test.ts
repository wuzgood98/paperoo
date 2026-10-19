import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import type { EditorPage } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import { exportDocument, exportDocumentWithReport } from "@/lib/pdf/export-pdf";
import { saveSwept, sweepUnreachable } from "@/lib/pdf/output-gc";
import { pdfSession } from "@/lib/pdf/session";

import { extractFigmaPage } from "./figma-extract";
import { buildPdfAnnotationFixture } from "./pdf-annotation-fixture";
import { buildPdfFormFixture, FORM_FIELD } from "./pdf-form-fixture";
import { allPageDictRefs, pdfContainsText } from "./pdf-scan";
import { editRun, twoLinePdf } from "./text-removal-fixtures";

afterEach(async () => {
  await pdfSession.close();
});

const openPages = async (bytes: Uint8Array): Promise<EditorPage[]> => {
  const { pages } = await pdfSession.open(Uint8Array.from(bytes));
  return pages;
};

const exportPages = (
  bytes: Uint8Array,
  pages: EditorPage[],
  pageIds?: string[]
): Promise<Uint8Array> =>
  exportDocument({
    assets: {},
    bytes,
    document: { pages },
    fontBytes: {},
    pageIds,
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
        P: first.ref,
        Rect: [10, 10, 110, 40],
        Subtype: "Link",
        Type: "Annot",
      })
    );
    first.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  }
  return new Uint8Array(await doc.save());
};

/** The output page index page 1's link lands on, and its `/P` page index. */
const linkTargets = async (
  bytes: Uint8Array
): Promise<{ dest: number; holder: number; pageDicts: number }> => {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages().map((page) => page.ref);
  const [entry] = doc.getPage(0).node.Annots()?.asArray() ?? [];
  const link = entry ? doc.context.lookup(entry) : undefined;
  const dest =
    link instanceof PDFDict ? link.lookup(PDFName.of("Dest")) : undefined;
  const target = dest instanceof PDFArray ? dest.get(0) : undefined;
  const holder =
    link instanceof PDFDict ? link.get(PDFName.of("P")) : undefined;
  const pageDicts = await allPageDictRefs(bytes);
  return {
    dest: target instanceof PDFRef ? pages.indexOf(target) : -1,
    holder: holder instanceof PDFRef ? pages.indexOf(holder) : -1,
    pageDicts: pageDicts.length,
  };
};

test("an edited run's old text is gone from the file, not just the page", async () => {
  const bytes = await twoLinePdf();
  const { page } = await extractFigmaPage(bytes);
  expect(await pdfContainsText(bytes, "Old line")).toBe(true);

  const report = await exportDocumentWithReport({
    assets: {},
    bytes,
    document: { pages: [editRun(page, "Old line", "New line")] },
    fontBytes: {},
  });

  expect(report.coverOnlyRunIds).toEqual([]);
  expect(await pdfContainsText(report.bytes, "Keep line")).toBe(true);
  expect(await pdfContainsText(report.bytes, "Old line")).toBe(false);
});

test("an OCR'd page still has its edited run removed, not covered", async () => {
  const bytes = await twoLinePdf();
  const { page } = await extractFigmaPage(bytes);
  const word: OcrTextObject = {
    baselineY: 140,
    confidence: 95,
    height: 18,
    id: "ocr-1",
    lineId: "line-1",
    pageId: page.id,
    source: "ocr",
    text: "Scanned",
    type: "ocr-text",
    width: 80,
    x: 72,
    y: 122,
  };

  const report = await exportDocumentWithReport({
    assets: {},
    bytes,
    document: { pages: [editRun(page, "Old line", "New line")] },
    fontBytes: {},
    ocrWordsByPage: { [page.id]: [word] },
  });

  expect(report.coverOnlyRunIds).toEqual([]);
  expect(await pdfContainsText(report.bytes, "Old line")).toBe(false);
  expect(await pdfContainsText(report.bytes, "Scanned")).toBe(true);
});

test("a removed free-text annotation leaves neither its text nor its appearance", async () => {
  const source = await PDFDocument.load(await buildPdfAnnotationFixture());
  for (const entry of source.getPage(0).node.Annots()?.asArray() ?? []) {
    const dict = source.context.lookup(entry);
    if (
      dict instanceof PDFDict &&
      dict.get(PDFName.of("Subtype")) === PDFName.of("FreeText")
    ) {
      const appearance = source.context.register(
        source.context.flateStream("BT /Helv 12 Tf (Appearance words) Tj ET", {
          BBox: [0, 0, 188, 28],
          Subtype: "Form",
        })
      );
      dict.set(PDFName.of("AP"), source.context.obj({ N: appearance }));
    }
  }
  const bytes = new Uint8Array(await source.save());
  const pages = await openPages(bytes);
  const removed = pages.map((page) => ({
    ...page,
    pdfAnnotationObjects: page.pdfAnnotationObjects.map((object) =>
      object.type === "pdf-free-text" ? { ...object, deleted: true } : object
    ),
  }));
  expect(
    removed[0]?.pdfAnnotationObjects.some((o) => o.type === "pdf-free-text")
  ).toBe(true);

  const output = await exportPages(bytes, removed);

  expect(await pdfContainsText(output, "Original free text")).toBe(false);
  expect(await pdfContainsText(output, "Appearance words")).toBe(false);
  expect(await pdfContainsText(output, "Original note")).toBe(true);
});

test("extracting page 1 keeps no value of a field only on page 2", async () => {
  const fixture = await PDFDocument.load(await buildPdfFormFixture());
  const form = fixture.getForm();
  const rotated = form.getTextField(FORM_FIELD.rotated).acroField.ref;
  const name = form.getTextField(FORM_FIELD.name).acroField.ref;
  form.acroForm.dict.set(
    PDFName.of("CO"),
    fixture.context.obj([rotated, name])
  );
  const bytes = new Uint8Array(
    await fixture.save({ updateFieldAppearances: false })
  );
  expect(await pdfContainsText(bytes, "Rotated")).toBe(true);
  const pages = await openPages(bytes);

  const output = await exportPages(bytes, pages, [pages[0]?.id ?? ""]);

  expect(await pdfContainsText(output, "Rotated")).toBe(false);
  expect(await pdfContainsText(output, FORM_FIELD.rotated)).toBe(false);
  expect(await pdfContainsText(output, "Gideon")).toBe(true);
  const exported = await PDFDocument.load(output);
  const order = exported.getForm().acroForm.dict.lookup(PDFName.of("CO"));
  expect(order instanceof PDFArray ? order.size() : 0).toBe(1);
  expect(exported.getPageCount()).toBe(1);
  expect(await allPageDictRefs(output)).toHaveLength(1);
});

test("a link lands on a page in the tree and no hidden page is written", async () => {
  const bytes = await labelledPdf(3);
  const pages = await openPages(bytes);
  const [first, , last] = pages;
  expect(first && last).toBeTruthy();
  if (!(first && last)) {
    return;
  }

  const all = await exportPages(bytes, pages);
  expect(await linkTargets(all)).toEqual({ dest: 2, holder: 0, pageDicts: 3 });

  const extracted = await exportPages(bytes, pages, [first.id, last.id]);
  expect(await linkTargets(extracted)).toEqual({
    dest: 1,
    holder: 0,
    pageDicts: 2,
  });

  // The target shown twice: the link goes to its first copy.
  const duplicated = await exportPages(bytes, [
    first,
    last,
    { ...last, id: `${last.id}-copy` },
  ]);
  expect(await linkTargets(duplicated)).toEqual({
    dest: 1,
    holder: 0,
    pageDicts: 3,
  });
});

test("the sweep drops unreachable objects and hidden pages, and keeps Info", async () => {
  const doc = await PDFDocument.create();
  doc.setTitle("Kept title");
  const page = doc.addPage([200, 200]);
  doc.context.register(doc.context.obj({ Secret: PDFString.of("Orphaned") }));
  const hidden = doc.context.register(
    doc.context.obj({
      Contents: doc.context.register(
        doc.context.flateStream("BT /F1 12 Tf (Hidden page) Tj ET")
      ),
      Type: "Page",
    })
  );
  const annot = doc.context.register(
    doc.context.obj({ P: hidden, Rect: [0, 0, 10, 10], Subtype: "Square" })
  );
  page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));

  const result = sweepUnreachable(doc);

  expect(result.hiddenPageEdges).toBe(1);
  // The orphan, the hidden page and its content stream.
  expect(result.deleted).toBe(3);
  expect(doc.context.lookup(annot, PDFDict).has(PDFName.of("P"))).toBe(false);
  const bytes = await saveSwept(doc);
  expect(await pdfContainsText(bytes, "Orphaned")).toBe(false);
  expect(await pdfContainsText(bytes, "Hidden page")).toBe(false);
  expect(await pdfContainsText(bytes, "Kept title")).toBe(true);
  const reloaded = await PDFDocument.load(bytes);
  expect(reloaded.getTitle()).toBe("Kept title");
});
