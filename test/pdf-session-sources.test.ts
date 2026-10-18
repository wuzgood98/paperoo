import { PDFDocument, PDFName } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import { resolvePdfLinkNavigation } from "@/lib/editor/annotation-links";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import { pdfSession } from "@/lib/pdf/session";

import "./pdfjs-node";

afterEach(async () => {
  await pdfSession.close();
});

const blankPdf = async (pageCount: number, size: [number, number]) => {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage(size);
  }
  return new Uint8Array(await doc.save());
};

/** Three pages; page 1 links to page 3 (index 2). */
const linkedPdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  const target = doc.addPage([300, 300]);
  const link = doc.context.register(
    doc.context.obj({
      Border: [0, 0, 0],
      Dest: [target.ref, PDFName.of("Fit")],
      Rect: [10, 10, 110, 40],
      Subtype: "Link",
      Type: "Annot",
    })
  );
  first.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  return new Uint8Array(await doc.save());
};

test("another source document opens beside the opened file", async () => {
  const opened = await pdfSession.open(await blankPdf(2, [300, 300]));
  const added = await pdfSession.addDocument(
    await blankPdf(1, [200, 400]),
    "other"
  );

  expect(opened.pages.every((page) => page.docId === undefined)).toBe(true);
  expect(
    added.pages.map((page) => [page.docId, page.width, page.height])
  ).toEqual([["other", 200, 400]]);
  expect(pdfSession.docIds()).toEqual([PRIMARY_DOC_ID, "other"]);

  const page = await pdfSession.retainPage({ docId: "other", sourceIndex: 0 });
  expect(page?.view).toEqual([0, 0, 200, 400]);
  pdfSession.releasePageRef({ docId: "other", sourceIndex: 0 });
  expect(pdfSession.cachedPageIndexes("other")).toEqual([0]);
  await expect(
    pdfSession.addDocument(await blankPdf(1, [10, 10]), "other")
  ).rejects.toThrow("already open");
});

test("opening a new file closes every source document", async () => {
  await pdfSession.open(await blankPdf(1, [300, 300]));
  await pdfSession.addDocument(await blankPdf(1, [200, 400]), "other");
  const before = pdfSession.generation;
  await pdfSession.open(await blankPdf(1, [300, 300]));
  expect(pdfSession.docIds()).toEqual([PRIMARY_DOC_ID]);
  expect(pdfSession.bytesOf("other")).toBeNull();
  expect(pdfSession.generation).toBeGreaterThan(before);
});

test("internal links resolve to the target page, not its object number", async () => {
  const { pages } = await pdfSession.open(await linkedPdf());
  const [first, , third] = pages;
  const link = first?.pdfAnnotationObjects.find(
    (object) => object.type === "pdf-link"
  );
  if (link?.type !== "pdf-link" || !first || !third) {
    throw new Error("fixture has no link");
  }
  expect(link.action).toMatchObject({ kind: "goto", pageIndex: 2 });

  // Reordered pages still navigate to the same source page.
  const document = { pages: [third, first] };
  expect(resolvePdfLinkNavigation(link.action, document, first.id)).toEqual({
    kind: "page",
    pageId: third.id,
  });
});
