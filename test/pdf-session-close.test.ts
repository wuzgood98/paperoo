import { PDFDocument } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import type { PageKey } from "@/lib/editor/page-source";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import { pdfSession } from "@/lib/pdf/session";

import "./pdfjs-node";

/** A page of the opened file. */
const primary = (sourceIndex: number): PageKey => ({
  docId: PRIMARY_DOC_ID,
  sourceIndex,
});

afterEach(async () => {
  await pdfSession.close();
});

const multiPagePdf = async (pageCount: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([200, 200]);
  }
  return new Uint8Array(await doc.save());
};

test("opening a new PDF while a page of the old one is still rendering succeeds", async () => {
  const nextBytes = await multiPagePdf(2);
  await pdfSession.open(await multiPagePdf(3));
  const page = await pdfSession.retainPage(primary(0));
  expect(page).toBeTruthy();
  // An operator list still streaming keeps the page "currently rendering",
  // which makes PDFDocumentProxy.cleanup() throw.
  const inFlight = page?.getOperatorList();
  inFlight?.catch(() => null);

  const next = await pdfSession.open(nextBytes);

  expect(next.pages).toHaveLength(2);
  expect(pdfSession.documentOf(PRIMARY_DOC_ID)?.numPages).toBe(2);
});

test("closing while a page is still rendering releases the document", async () => {
  await pdfSession.open(await multiPagePdf(2));
  const page = await pdfSession.retainPage(primary(1));
  page?.getOperatorList().catch(() => null);

  await expect(pdfSession.close()).resolves.toBeUndefined();
  expect(pdfSession.documentOf(PRIMARY_DOC_ID)).toBeNull();
  expect(pdfSession.cachedPageIndexes()).toEqual([]);
});

test("two opens in quick succession leave the newer PDF open", async () => {
  const [olderBytes, newerBytes] = await Promise.all([
    multiPagePdf(3),
    multiPagePdf(2),
  ]);

  const older = pdfSession.open(olderBytes);
  const newer = pdfSession.open(newerBytes);

  await expect(older).rejects.toThrow("This PDF is no longer open.");
  await expect(newer).resolves.toMatchObject({
    pages: expect.arrayContaining([expect.anything()]),
  });
  expect(pdfSession.documentOf(PRIMARY_DOC_ID)?.numPages).toBe(2);
});
