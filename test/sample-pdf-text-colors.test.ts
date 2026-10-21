import { readFile } from "node:fs/promises";
import path from "node:path";

import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";

import { toExtractableTextContent } from "@/lib/pdf/extract-text";
import {
  extractPdfTextPaints,
  toPdfTextColorOps,
  zipPdfTextItemPaints,
} from "@/lib/pdf/extract-text-colors";

import { loadPdfJsDocument } from "./pdfjs-node";

type PdfJsDocument = Awaited<ReturnType<typeof loadPdfJsDocument>["promise"]>;

/** Same pipeline as PdfSession page extraction. Null when the page aligns. */
const misalignment = async (
  doc: PdfJsDocument,
  pageNumber: number
): Promise<string | null> => {
  const page = await doc.getPage(pageNumber);
  const [textContent, operatorList] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const content = toExtractableTextContent(textContent);
  const paints = extractPdfTextPaints(operatorList, toPdfTextColorOps(OPS));
  const { aligned } = zipPdfTextItemPaints(content.items, paints);
  const nullPaints = paints.filter((paint) => paint === null).length;
  if (aligned && nullPaints === 0) {
    return null;
  }
  return `page ${pageNumber}: aligned=${aligned} paints=${paints.length} items=${content.items.length} null=${nullPaints}`;
};

// A misaligned zip fails closed to the default text color, so every run on
// the page would lose its ink.
test("test/fixtures/sample.pdf text paints align with text items on every page", async () => {
  const bytes = await readFile(
    path.join(process.cwd(), "test/fixtures/sample.pdf")
  );
  const loadingTask = loadPdfJsDocument(new Uint8Array(bytes));
  try {
    const doc = await loadingTask.promise;
    const pageNumbers = Array.from(
      { length: doc.numPages },
      (_, index) => index + 1
    );
    const report = await Promise.all(
      pageNumbers.map((pageNumber) => misalignment(doc, pageNumber))
    );
    expect(report.filter(Boolean)).toEqual([]);
  } finally {
    await loadingTask.destroy();
  }
});
