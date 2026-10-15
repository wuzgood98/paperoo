import { afterEach, expect, test, vi } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { ensurePdfTextMeasured } from "@/lib/pdf/sample-pdf-text-cover";
import type { PdfTextMeasureEnv } from "@/lib/pdf/sample-pdf-text-cover";

const probe = vi.fn<PdfTextMeasureEnv["probeFontGlyphs"]>();

// No canvas in node: sampling yields no cover color, which is the fallback.
const env: PdfTextMeasureEnv = {
  loadPageCanvas: () => Promise.resolve(null),
  probeFontGlyphs: probe,
};

interface Deferred {
  promise: Promise<string>;
  reject: (error: Error) => void;
  resolve: (value: string) => void;
}

const deferred = (): Deferred => {
  const handlers: Partial<Pick<Deferred, "reject" | "resolve">> = {};
  // oxlint-disable-next-line promise/avoid-new -- the test settles the probe by hand
  const promise = new Promise<string>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return {
    promise,
    reject: (error) => handlers.reject?.(error),
    resolve: (value) => handlers.resolve?.(value),
  };
};

const run = (id: string, text: string): PdfTextObject => ({
  baseFontName: "ABCDEF+TestSans",
  color: "#111827",
  dir: "ltr",
  fontFamily: "sans",
  fontName: "g_d0_f1",
  fontSize: 16,
  hasEOL: false,
  height: 16,
  id,
  originalColor: "#111827",
  originalFontFamily: "sans",
  originalFontSize: 16,
  originalStrokeColor: "#000000",
  originalStrokeWidth: 1,
  originalText: text,
  originalTextRenderingMode: 0,
  pageId: "page-1",
  rotation: 0,
  sourceIndex: 0,
  strokeColor: "#000000",
  strokeWidth: 1,
  text,
  textRenderingMode: 0,
  transform: [16, 0, 0, 16, 72, 700],
  type: "pdf-text",
  width: 40,
  x: 72,
  y: 76,
});

const page = (): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id: "page-1",
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [run("pdf-1", "Hello"), run("pdf-2", "Bye")],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex: 0,
  sourceRotate: 0,
  width: 612,
});

const runById = (id: string): PdfTextObject | undefined =>
  editorStore
    .getState()
    .document.pages[0]?.pdfTextObjects.find((object) => object.id === id);

afterEach(() => {
  editorStore.clearDocument();
  probe.mockReset();
});

test("concurrent measurements of one run share a single probe", async () => {
  const pending = deferred();
  probe.mockReturnValue(pending.promise);
  const editorPage = page();
  editorStore.resetDocument([editorPage], "demo.pdf");
  const [target] = editorPage.pdfTextObjects;
  expect(target).toBeDefined();
  if (!target) {
    return;
  }

  const first = ensurePdfTextMeasured(editorPage, target, 1, env);
  const second = ensurePdfTextMeasured(editorPage, target, 1, env);
  expect(second).toBe(first);
  pending.resolve("Hel");
  await first;
  expect(probe).toHaveBeenCalledTimes(1);

  const measured = runById("pdf-1");
  expect(measured?.reusableFontGlyphs).toBe("Hel");
  expect(measured?.coverRects?.length).toBeGreaterThan(0);
  expect(measured?.coverColor).toBeUndefined();

  if (measured) {
    await ensurePdfTextMeasured(editorPage, measured, 1, env);
  }
  expect(probe).toHaveBeenCalledTimes(1);
  expect(editorStore.canUndo()).toBe(false);
});

test("a measurement lands on its run after the selection moves", async () => {
  const pending = deferred();
  probe.mockReturnValue(pending.promise);
  const editorPage = page();
  editorStore.resetDocument([editorPage], "demo.pdf");
  editorStore.selectPdfText("pdf-1");
  const [target] = editorPage.pdfTextObjects;
  if (!target) {
    throw new Error("fixture has no first run");
  }

  const measuring = ensurePdfTextMeasured(editorPage, target, 1, env);
  editorStore.selectPdfText("pdf-2");
  pending.resolve("Helo");
  await measuring;

  expect(runById("pdf-1")?.reusableFontGlyphs).toBe("Helo");
  expect(runById("pdf-2")?.reusableFontGlyphs).toBeUndefined();
  expect(runById("pdf-2")?.coverRects).toBeUndefined();
});

test("the font probe reads the run's page, not its text item index", async () => {
  probe.mockResolvedValue("abc");
  const editorPage: EditorPage = {
    ...page(),
    pdfTextObjects: [{ ...run("pdf-1", "Hello"), sourceIndex: 42 }],
    sourceIndex: 1,
  };
  editorStore.resetDocument([editorPage], "demo.pdf");
  const [target] = editorPage.pdfTextObjects;
  if (!target) {
    throw new Error("fixture has no first run");
  }

  await ensurePdfTextMeasured(editorPage, target, 1, env);

  expect(probe).toHaveBeenCalledWith(1, "ABCDEF+TestSans");
});

test("a failed font probe still stores the cover and no reuse", async () => {
  probe.mockRejectedValue(new Error("pdf-lib could not parse the file"));
  const editorPage = page();
  editorStore.resetDocument([editorPage], "demo.pdf");
  const [target] = editorPage.pdfTextObjects;
  if (!target) {
    throw new Error("fixture has no first run");
  }

  await expect(
    ensurePdfTextMeasured(editorPage, target, 1, env)
  ).resolves.toBeUndefined();
  expect(runById("pdf-1")?.reusableFontGlyphs).toBe("");
  expect(runById("pdf-1")?.coverRects?.length).toBeGreaterThan(0);
});
