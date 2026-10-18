import { PDFDocument } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import type { PageKey } from "@/lib/editor/page-source";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import { DEFAULT_PAGE_IDLE_CACHE, pdfSession } from "@/lib/pdf/session";

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

const churnIdlePages = async (
  fromIndex: number,
  toIndexExclusive: number
): Promise<void> => {
  if (fromIndex >= toIndexExclusive) {
    return;
  }
  const page = await pdfSession.retainPage(primary(fromIndex));
  expect(page).toBeTruthy();
  pdfSession.releasePageRef(primary(fromIndex));
  await churnIdlePages(fromIndex + 1, toIndexExclusive);
};

test("retainPage keeps proxy until all consumers release", async () => {
  await pdfSession.open(await multiPagePdf(2));

  const first = await pdfSession.retainPage(primary(0));
  const second = await pdfSession.retainPage(primary(0));
  expect(first).toBeTruthy();
  expect(second).toBe(first);
  expect(pdfSession.cachedPageIndexes()).toContain(0);

  pdfSession.releasePageRef(primary(0));
  expect(pdfSession.cachedPageIndexes()).toContain(0);

  pdfSession.releasePageRef(primary(0));
  expect(pdfSession.cachedPageIndexes()).toContain(0);
});

test("idle pages over budget are evicted by LRU", async () => {
  // setIdleCacheBudget(visible) → max(10, 2*visible+1); visible=0 → budget 10
  const pageCount = DEFAULT_PAGE_IDLE_CACHE + 3;
  await pdfSession.open(await multiPagePdf(pageCount));
  pdfSession.setIdleCacheBudget(0);

  await churnIdlePages(0, pageCount);

  const cached = pdfSession.cachedPageIndexes();
  expect(cached.length).toBe(DEFAULT_PAGE_IDLE_CACHE);
  expect(cached).not.toContain(0);
  expect(cached).toContain(pageCount - 1);
});

test("live retained pages are not evicted", async () => {
  const pageCount = DEFAULT_PAGE_IDLE_CACHE + 2;
  await pdfSession.open(await multiPagePdf(pageCount));
  pdfSession.setIdleCacheBudget(0);

  await pdfSession.retainPage(primary(0));
  await churnIdlePages(1, pageCount);

  expect(pdfSession.cachedPageIndexes()).toContain(0);
  expect(pdfSession.cachedPageIndexes()).not.toContain(1);
  pdfSession.releasePageRef(primary(0));
});
