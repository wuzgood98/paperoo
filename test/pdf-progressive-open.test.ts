import { PDFDocument } from "pdf-lib";
import { afterEach, expect, test } from "vitest";

import type { PageKey } from "@/lib/editor/page-source";
import { editorStore } from "@/lib/editor/store";
import { EMPTY_PDF_FORM, PRIMARY_DOC_ID } from "@/lib/editor/types";
import type { EditorPage, TextObject } from "@/lib/editor/types";
import {
  DEFAULT_PAGE_IDLE_CACHE,
  FIRST_PAINT_PAGES,
  pdfSession,
} from "@/lib/pdf/session";
import type { ProgressiveOpenHandlers } from "@/lib/pdf/session";

import "./pdfjs-node";

/** A page of the opened file. */
const primary = (sourceIndex: number): PageKey => ({
  docId: PRIMARY_DOC_ID,
  sourceIndex,
});

afterEach(async () => {
  await pdfSession.close();
  editorStore.clearDocument();
});

const multiPagePdf = async (pageCount: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([200, 200]);
  }
  return new Uint8Array(await doc.save());
};

/** Stand in for the canvas painting, so background reading starts at once. */
const markPainted = (): void => {
  pdfSession.markFirstPaint();
};

const quietHandlers = (): ProgressiveOpenHandlers => ({
  onFirstPages: markPainted,
  onForm: () => {},
  onMorePages: () => {},
});

const overlay = (id: string): TextObject => ({
  align: "left",
  color: "#111827",
  content: "Overlay",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 28,
  id,
  italic: false,
  opacity: 1,
  rotation: 0,
  source: "overlay",
  type: "text",
  width: 120,
  x: 40,
  y: 40,
});

const page = (id: string, sourceIndex: number): EditorPage => ({
  cropBox: { height: 200, width: 200, x: 0, y: 0 },
  height: 200,
  id,
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex,
  sourceRotate: 0,
  width: 200,
});

test("progressive open paints the first window before the rest", async () => {
  const pageCount = FIRST_PAINT_PAGES + 2;
  const seen: string[] = [];
  let firstBatch = -1;
  let formDelivered = false;

  await pdfSession.openProgressive(await multiPagePdf(pageCount), {
    onFirstPages: (pages) => {
      firstBatch = pages.length;
      seen.push(...pages.map((entry) => entry.id));
      markPainted();
    },
    onForm: () => {
      formDelivered = true;
    },
    onMorePages: (pages) => {
      seen.push(...pages.map((entry) => entry.id));
    },
  });

  expect(firstBatch).toBe(FIRST_PAINT_PAGES);
  expect(seen.length).toBe(pageCount);
  expect(new Set(seen).size).toBe(pageCount);
  expect(formDelivered).toBe(true);
});

test("background reading waits for the first canvas to paint", async () => {
  const pageCount = FIRST_PAINT_PAGES + 2;
  let moreCalls = 0;
  const firstPages = Promise.withResolvers<boolean>();

  const opening = pdfSession.openProgressive(await multiPagePdf(pageCount), {
    onFirstPages: () => {
      firstPages.resolve(true);
    },
    onForm: () => {},
    onMorePages: () => {
      moreCalls += 1;
    },
  });
  await firstPages.promise;
  // oxlint-disable-next-line promise/avoid-new -- give the worker time to run ahead
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
  expect(moreCalls).toBe(0);

  markPainted();
  await opening;
  expect(moreCalls).toBeGreaterThan(0);
});

test("cancelled progressive open stops background hydration", async () => {
  const pageCount = FIRST_PAINT_PAGES + 2;
  let moreCalls = 0;
  let cancelled = false;

  await pdfSession.openProgressive(await multiPagePdf(pageCount), {
    isCancelled: () => cancelled,
    onFirstPages: () => {
      cancelled = true;
      markPainted();
    },
    onForm: () => {
      throw new Error("form should not arrive after cancel");
    },
    onMorePages: () => {
      moreCalls += 1;
    },
  });

  expect(moreCalls).toBe(0);
});

test("appendPages merges sorted without duplicates or history", () => {
  editorStore.resetDocument([page("a", 0)], "demo.pdf", EMPTY_PDF_FORM);
  editorStore.appendPages([page("c", 2), page("b", 1)]);
  editorStore.appendPages([page("b", 1)]);

  const { pages } = editorStore.getState().document;
  expect(pages.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  expect(editorStore.getState().currentPageId).toBe("a");
  expect(editorStore.canUndo()).toBe(false);
});

test("setDocumentForm replaces the form model", () => {
  editorStore.resetDocument([page("a", 0)], "demo.pdf", EMPTY_PDF_FORM);
  editorStore.setDocumentForm({
    ...EMPTY_PDF_FORM,
    hasJavaScript: true,
  });
  expect(editorStore.getState().document.form?.hasJavaScript).toBe(true);
});

test("appendPages keeps later pages when an earlier edit is undone", () => {
  editorStore.resetDocument([page("a", 0)], "demo.pdf", EMPTY_PDF_FORM);
  editorStore.addObject(overlay("overlay-1"));
  editorStore.appendPages([page("c", 2), page("b", 1)]);

  editorStore.undo();

  const { pages } = editorStore.getState().document;
  expect(pages.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  expect(pages[0]?.objects).toEqual([]);

  editorStore.redo();
  const redone = editorStore.getState().document.pages;
  expect(redone.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  expect(redone[0]?.objects).toHaveLength(1);
});

test("appendPages does not reshuffle a page order the user changed", () => {
  editorStore.resetDocument(
    [page("a", 0), page("b", 1), page("c", 2)],
    "demo.pdf",
    EMPTY_PDF_FORM
  );
  editorStore.setPages([page("c", 2), page("a", 0), page("b", 1)]);
  editorStore.appendPages([page("d", 3)]);

  expect(
    editorStore.getState().document.pages.map((entry) => entry.id)
  ).toEqual(["c", "a", "b", "d"]);
});

test("setDocumentForm stays on the undone snapshot and does not clobber a later form", () => {
  editorStore.resetDocument([page("a", 0)], "demo.pdf", EMPTY_PDF_FORM);
  editorStore.setDocumentForm({
    ...EMPTY_PDF_FORM,
    hasJavaScript: true,
  });
  editorStore.addObject(overlay("overlay-1"));
  editorStore.setDocumentForm({
    ...EMPTY_PDF_FORM,
    hasXfa: true,
  });

  editorStore.undo();

  const { form } = editorStore.getState().document;
  expect(form?.hasJavaScript).toBe(true);
  expect(form?.hasXfa).toBe(false);
});

test("progressive open keeps the first window cached past the idle budget", async () => {
  const pageCount = DEFAULT_PAGE_IDLE_CACHE + FIRST_PAINT_PAGES + 2;
  await pdfSession.openProgressive(
    await multiPagePdf(pageCount),
    quietHandlers()
  );

  const cached = pdfSession.cachedPageIndexes();
  for (let index = 0; index < FIRST_PAINT_PAGES; index += 1) {
    expect(cached).toContain(index);
  }
});

test("a retained first-window page can be evicted after release", async () => {
  const pageCount = DEFAULT_PAGE_IDLE_CACHE + FIRST_PAINT_PAGES + 2;
  await pdfSession.openProgressive(
    await multiPagePdf(pageCount),
    quietHandlers()
  );

  expect(await pdfSession.retainPage(primary(0))).toBeTruthy();
  pdfSession.releasePageRef(primary(0));
  for (let index = FIRST_PAINT_PAGES; index < pageCount; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- retain then release, in order, is what walks the LRU
    expect(await pdfSession.retainPage(primary(index))).toBeTruthy();
    pdfSession.releasePageRef(primary(index));
  }

  const cached = pdfSession.cachedPageIndexes();
  expect(cached).not.toContain(0);
  expect(cached).toContain(1);
  expect(cached).toContain(2);
});

test("a newer progressive open drops the first file's cached pages", async () => {
  const firstBytes = await multiPagePdf(DEFAULT_PAGE_IDLE_CACHE + 4);
  const secondBytes = await multiPagePdf(1);
  let second: Promise<{ pageCount: number }> | undefined;

  const first = pdfSession.openProgressive(firstBytes, {
    isCancelled: () => second !== undefined,
    onFirstPages: () => {
      second = pdfSession.openProgressive(secondBytes, quietHandlers());
    },
    onForm: () => {
      throw new Error("form should not arrive after cancel");
    },
    onMorePages: () => {
      throw new Error("pages should not arrive after cancel");
    },
  });

  await first;
  await second;
  expect(pdfSession.documentOf(PRIMARY_DOC_ID)?.numPages).toBe(1);
  expect(pdfSession.cachedPageIndexes()).toEqual([0]);
});

/** Catalog claims one page, but the kid is missing, so extraction yields nothing. */
const missingPagePdf = (): Uint8Array => {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefAt = body.length;
  let xref = "xref\n0 3\n0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
};

test("an empty PDF does not deliver a form", async () => {
  let formCalls = 0;

  await expect(
    pdfSession.openProgressive(missingPagePdf(), {
      onFirstPages: () => {},
      onForm: () => {
        formCalls += 1;
      },
      onMorePages: () => {},
    })
  ).rejects.toThrow("This PDF has no pages.");
  expect(formCalls).toBe(0);
});
