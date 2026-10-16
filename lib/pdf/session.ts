import { normalizeRotation } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type { EditorPage, PdfFormModel } from "@/lib/editor/types";
import {
  DEFAULT_PDF_TEXT_COLOR,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
} from "@/lib/editor/types";
import { clonePdfBytes } from "@/lib/pdf/bytes";
import { extractPdfAnnotationObjects } from "@/lib/pdf/extract-annotations";
import { extractPdfForm } from "@/lib/pdf/extract-forms";
import {
  extractPdfImageObjects,
  toPdfImageOps,
} from "@/lib/pdf/extract-images";
import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type {
  PdfFontFaceMeta,
  PdfJsFontObjectStore,
} from "@/lib/pdf/extract-text";
import {
  extractPdfTextPaints,
  toPdfTextColorOps,
  zipPdfTextItemPaints,
} from "@/lib/pdf/extract-text-colors";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";
import { linkTextInkOutlines } from "@/lib/pdf/link-text-ink";
import {
  AnnotationMode,
  ensurePdfjsWorker,
  getDocument,
  OPS,
  PasswordException,
  PDFJS_CMAP_URL,
  PDFJS_ICC_URL,
  PDFJS_STANDARD_FONT_URL,
  PDFJS_WASM_URL,
} from "@/lib/pdf/pdfjs";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "@/lib/pdf/pdfjs";
import {
  attachRemovalTargets,
  indexPageRemovals,
} from "@/lib/pdf/removal-targets";

export const PDF_HEADER = "%PDF";

/** Matches mozilla/pdf.js PDFPageViewBuffer DEFAULT_CACHE_SIZE. */
export const DEFAULT_PAGE_IDLE_CACHE = 10;

declare global {
  /** Prioritized Task Scheduling API; not in TypeScript's DOM lib yet. */
  // oxlint-disable-next-line no-var -- global declarations must use var
  var scheduler:
    | {
        postTask: (
          callback: () => void,
          options: { priority: "background" }
        ) => Promise<void>;
      }
    | undefined;
}

/**
 * Yield between hydration chunks. Background priority lets input, rendering
 * and visible-page work run first; `scheduler.yield()` would do the opposite
 * and resume this continuation ahead of them.
 */
const yieldToUI = async (): Promise<void> => {
  if (globalThis.scheduler) {
    await globalThis.scheduler.postTask(() => null, { priority: "background" });
    return;
  }
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise API
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

interface FormProbes {
  calculationOrderIds: Awaited<
    ReturnType<PDFDocumentProxy["getCalculationOrderIds"]>
  >;
  hasJavaScript: Awaited<ReturnType<PDFDocumentProxy["hasJSActions"]>>;
  signatures: Awaited<ReturnType<PDFDocumentProxy["getSignatures"]>>;
}

/** Doc-level probes overlap page extraction; rejection still fails the open. */
const startFormProbes = async (doc: PDFDocumentProxy): Promise<FormProbes> => {
  const [hasJavaScript, signatures, calculationOrderIds] = await Promise.all([
    doc.hasJSActions(),
    doc.getSignatures(),
    doc.getCalculationOrderIds(),
  ]);
  return { calculationOrderIds, hasJavaScript, signatures };
};

/** Attach a handler so a fast probe failure is not an unhandled rejection. */
const observeRejection = (promise: Promise<unknown>): void => {
  void (async () => {
    try {
      await promise;
    } catch (error) {
      // The open awaits this same promise when it is still the current file.
      void error;
    }
  })();
};

/** First paint covers the initial viewport window (visible + overscan). */
/** Type3 glyph-procedure ops that only declare metrics and paint nothing. */
const TYPE3_METRIC_OPS: ReadonlySet<number> = new Set([
  OPS.setCharWidth,
  OPS.setCharWidthAndBounds,
]);

const paintlessFontIds = (
  faces: Readonly<Record<string, PdfFontFaceMeta>>
): Set<string> => {
  const ids = new Set<string>();
  for (const [id, face] of Object.entries(faces)) {
    if (face.paintsNothing === true) {
      ids.add(id);
    }
  }
  return ids;
};

export const FIRST_PAINT_PAGES = 3;

/** Bound worker fan-out so N-page opens don't queue 3N requests at once. */
export const OPEN_PAGE_CONCURRENCY = 4;

interface PageCacheEntry {
  page: PDFPageProxy;
  refs: number;
}

interface BuiltPage {
  editorPage: EditorPage;
  rawAnnotations: unknown[];
}

export interface ProgressiveOpenHandlers {
  onFirstPages: (pages: EditorPage[]) => void;
  onMorePages: (pages: EditorPage[]) => void;
  onForm: (form: PdfFormModel) => void;
  /** Return true when a newer open superseded this one; background work stops. */
  isCancelled?: () => boolean;
}

const formFromBuilt = (
  doc: PDFDocumentProxy,
  built: readonly BuiltPage[],
  probes: FormProbes
): PdfFormModel => {
  const calculationCount = probes.calculationOrderIds?.length ?? 0;
  return extractPdfForm({
    hasJavaScript: probes.hasJavaScript || calculationCount > 0,
    hasXfa: doc.isPureXfa,
    pages: built.map((entry) => ({
      annotations: entry.rawAnnotations,
      page: {
        cropBox: entry.editorPage.cropBox,
        id: entry.editorPage.id,
        sourceRotate: entry.editorPage.sourceRotate,
      },
    })),
    signatures: probes.signatures ?? [],
  });
};

class PdfSession {
  bytes: Uint8Array | null = null;
  #doc: PDFDocumentProxy | null = null;
  #loadingTask: PDFDocumentLoadingTask | null = null;
  #pages = new Map<number, PageCacheEntry>();
  /** Idle (refs === 0) source indexes, oldest first. */
  #idleOrder: number[] = [];
  #idleBudget = DEFAULT_PAGE_IDLE_CACHE;
  /**
   * First-paint indexes kept out of LRU until `retainPage` takes a live ref.
   * Hydration would otherwise evict them before the viewport chunk loads.
   */
  #pinned = new Set<number>();

  get document(): PDFDocumentProxy | null {
    return this.#doc;
  }

  /** Cap idle retained pages ≈ PDF.js `max(10, 2 * visible + 1)`. */
  setIdleCacheBudget(visibleCount: number): void {
    this.#idleBudget = Math.max(DEFAULT_PAGE_IDLE_CACHE, 2 * visibleCount + 1);
    this.#evictIdle();
  }

  async open(
    bytes: Uint8Array
  ): Promise<{ form: PdfFormModel; pages: EditorPage[] }> {
    const doc = await this.#openDocument(bytes);
    // Doc-level probes are page-independent: start them before the page loop
    // so worker round-trips overlap page extraction instead of tailing it.
    const formProbes = startFormProbes(doc);
    observeRejection(formProbes);
    const built = await this.#loadPageRange(0, doc.numPages);
    if (this.#doc !== doc) {
      throw new Error("This PDF is no longer open.");
    }
    const probes = await formProbes;
    if (this.#doc !== doc) {
      throw new Error("This PDF is no longer open.");
    }
    return {
      form: formFromBuilt(doc, built, probes),
      pages: built.map((entry) => entry.editorPage),
    };
  }

  /**
   * Two-phase open: extract the first window so the caller can paint
   * immediately (via onFirstPages), then hydrate the rest in bounded chunks
   * (via onMorePages) with yields between chunks, finishing with onForm.
   * The promise resolves after the form arrives. Use `isCancelled` to abandon
   * background work when a newer file is selected.
   */
  async openProgressive(
    bytes: Uint8Array,
    handlers: ProgressiveOpenHandlers
  ): Promise<{ pageCount: number }> {
    const doc = await this.#openDocument(bytes);
    const cancelled = handlers.isCancelled ?? ((): boolean => false);
    const formProbes = startFormProbes(doc);
    observeRejection(formProbes);
    const totalPages = doc.numPages;
    if (totalPages === 0) {
      throw new Error("This PDF has no pages.");
    }
    const firstCount = Math.min(FIRST_PAINT_PAGES, totalPages);
    const first = await this.#loadPageRange(0, firstCount);
    if (cancelled() || this.#doc !== doc) {
      return { pageCount: totalPages };
    }
    if (first.length === 0) {
      throw new Error("This PDF has no pages.");
    }
    this.#pinFirstWindow(firstCount);
    const allBuilt: BuiltPage[] = [...first];
    handlers.onFirstPages(first.map((entry) => entry.editorPage));

    const hydrated = await this.#hydrateRemaining(
      firstCount,
      totalPages,
      allBuilt,
      handlers,
      doc,
      cancelled
    );
    if (!hydrated || cancelled() || this.#doc !== doc) {
      return { pageCount: totalPages };
    }
    const probes = await formProbes;
    if (cancelled() || this.#doc !== doc) {
      return { pageCount: totalPages };
    }
    handlers.onForm(formFromBuilt(doc, allBuilt, probes));
    return { pageCount: totalPages };
  }

  async #openDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
    await this.close();
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new Error("This PDF is larger than the 80 MB limit.");
    }
    ensurePdfjsWorker();
    this.bytes = clonePdfBytes(bytes);
    this.#loadingTask = getDocument({
      cMapPacked: true,
      cMapUrl: PDFJS_CMAP_URL,
      data: bytes,
      iccUrl: PDFJS_ICC_URL,
      standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
      wasmUrl: PDFJS_WASM_URL,
    });

    let doc: PDFDocumentProxy;
    try {
      doc = await this.#loadingTask.promise;
    } catch (error) {
      await this.close();
      if (error instanceof PasswordException) {
        throw new TypeError("This PDF is encrypted and cannot be opened.", {
          cause: error,
        });
      }
      throw error;
    }

    this.#doc = doc;
    if (doc.numPages > MAX_PDF_PAGES) {
      await this.close();
      throw new Error(`This PDF has more than ${MAX_PDF_PAGES} pages.`);
    }
    return doc;
  }

  /** Keep the first window resident until a canvas retains it. */
  #pinFirstWindow(count: number): void {
    for (let index = 0; index < count; index += 1) {
      if (this.#pages.has(index)) {
        this.#pinned.add(index);
      }
    }
  }

  /**
   * Hydrate pages after the first window in bounded chunks, yielding between
   * chunks so scrolling and editing stay responsive. Returns false when
   * cancelled; `allBuilt` accumulates every extracted page for the form model.
   */
  async #hydrateRemaining(
    firstCount: number,
    totalPages: number,
    allBuilt: BuiltPage[],
    handlers: ProgressiveOpenHandlers,
    doc: PDFDocumentProxy,
    cancelled: () => boolean
  ): Promise<boolean> {
    if (this.#doc !== doc) {
      return false;
    }
    if (firstCount >= totalPages) {
      return !cancelled();
    }
    // Yield so first paint commits before background hydration starts.
    await yieldToUI();
    for (
      let start = firstCount;
      start < totalPages;
      start += OPEN_PAGE_CONCURRENCY
    ) {
      if (cancelled() || this.#doc !== doc) {
        return false;
      }
      const end = Math.min(start + OPEN_PAGE_CONCURRENCY, totalPages);
      // oxlint-disable-next-line eslint/no-await-in-loop -- bounded sequential hydration chunks keep the UI responsive
      const chunk = await this.#loadPageRange(start, end);
      if (cancelled() || this.#doc !== doc) {
        return false;
      }
      allBuilt.push(...chunk);
      handlers.onMorePages(chunk.map((entry) => entry.editorPage));
      // Yield between chunks to keep scrolling/editing responsive.
      // oxlint-disable-next-line eslint/no-await-in-loop -- bounded sequential hydration chunks keep the UI responsive
      await yieldToUI();
    }
    return !(cancelled() || this.#doc !== doc);
  }

  /** Extract [start, end) with bounded concurrency, preserving order. */
  async #loadPageRange(start: number, end: number): Promise<BuiltPage[]> {
    const results = Array.from(
      { length: end - start },
      (): BuiltPage | null => null
    );
    for (
      let chunkStart = start;
      chunkStart < end;
      chunkStart += OPEN_PAGE_CONCURRENCY
    ) {
      const chunkEnd = Math.min(chunkStart + OPEN_PAGE_CONCURRENCY, end);
      // oxlint-disable-next-line eslint/no-await-in-loop -- bounded concurrency: one chunk of pages at a time
      const chunk = await Promise.all(
        Array.from({ length: chunkEnd - chunkStart }, (_, offset) =>
          this.#loadPage(chunkStart + offset)
        )
      );
      for (const [offset, entry] of chunk.entries()) {
        results[chunkStart - start + offset] = entry;
      }
    }
    return results.filter((entry): entry is BuiltPage => entry !== null);
  }

  /** Fetch, extract, and cache a single page for later render reuse. */
  async #loadPage(sourceIndex: number): Promise<BuiltPage | null> {
    const doc = this.#doc;
    if (!doc) {
      return null;
    }
    let page: PDFPageProxy;
    try {
      page = await doc.getPage(sourceIndex + 1);
    } catch {
      return null;
    }
    if (!this.#cachePage(doc, sourceIndex, page)) {
      return null;
    }

    const viewport = page.getViewport({ scale: 1 });
    const { view } = page;
    let textContent: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
    let operatorList: Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>;
    let rawAnnotations: Awaited<ReturnType<PDFPageProxy["getAnnotations"]>>;
    try {
      [textContent, operatorList, rawAnnotations] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList({ annotationMode: AnnotationMode.DISABLE }),
        page.getAnnotations({ intent: "display" }),
      ]);
    } catch (error) {
      if (this.#doc !== doc) {
        return null;
      }
      throw error;
    }
    if (this.#doc !== doc) {
      return null;
    }
    const cropBox = {
      height: view[3] - view[1],
      width: view[2] - view[0],
      x: view[0],
      y: view[1],
    };
    const id = createId();
    const sourceRotate = normalizeRotation(page.rotate);
    const extractPage = {
      cropBox,
      id,
      sourceRotate,
    };
    const { objects: pdfAnnotationObjects, skippedSubtypes } =
      extractPdfAnnotationObjects(rawAnnotations, extractPage);
    const extractableText = toExtractableTextContent(textContent);
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    const fontFaces = await collectPdfFontFaces(
      page.commonObjs as PdfJsFontObjectStore,
      extractableText.items,
      TYPE3_METRIC_OPS
    );
    if (this.#doc !== doc) {
      return null;
    }
    const textPaints = extractPdfTextPaints(
      operatorList,
      toPdfTextColorOps(OPS)
    );
    const { paints: itemPaints } = zipPdfTextItemPaints(
      extractableText.items,
      textPaints,
      DEFAULT_PDF_TEXT_COLOR
    );
    const extractedVectors = extractPdfVectorObjects(
      operatorList,
      extractPage,
      toPdfVectorOps(OPS),
      paintlessFontIds(fontFaces)
    );
    const removalIndex = indexPageRemovals(operatorList, OPS);
    const { runs: pdfTextObjects, vectors: pdfVectorObjects } =
      attachRemovalTargets(
        removalIndex,
        linkTextInkOutlines(
          extractPdfTextObjects(
            extractableText,
            extractPage,
            fontFaces,
            itemPaints
          ),
          extractedVectors
        ),
        extractedVectors
      );
    const editorPage = {
      contentOpCounts: removalIndex.counts,
      cropBox,
      height: viewport.height,
      id,
      objects: [],
      pdfAnnotationObjects,
      pdfImageObjects: extractPdfImageObjects(
        operatorList,
        extractPage,
        toPdfImageOps(OPS)
      ),
      pdfTextObjects,
      pdfVectorObjects,
      rotation: 0,
      skippedPdfAnnotationSubtypes: skippedSubtypes,
      sourceIndex,
      sourceRotate,
      width: viewport.width,
    } satisfies EditorPage;
    page.cleanup();
    return { editorPage, rawAnnotations };
  }

  async getPage(sourceIndex: number): Promise<PDFPageProxy | null> {
    const cached = this.#pages.get(sourceIndex);
    if (cached) {
      return cached.page;
    }
    const doc = this.#doc;
    if (!doc) {
      return null;
    }
    const page = await doc.getPage(sourceIndex + 1);
    if (!this.#cachePage(doc, sourceIndex, page)) {
      return null;
    }
    return page;
  }

  /**
   * Cache `page` only while `doc` is still the open document.
   * A superseded open's continuation must not put a destroyed proxy back.
   */
  #cachePage(
    doc: PDFDocumentProxy,
    sourceIndex: number,
    page: PDFPageProxy
  ): boolean {
    if (this.#doc !== doc) {
      return false;
    }
    this.#pages.set(sourceIndex, { page, refs: 0 });
    this.#touchIdle(sourceIndex);
    this.#evictIdle();
    return true;
  }

  /** Load (or reuse) a page and increment its live consumer count. */
  async retainPage(sourceIndex: number): Promise<PDFPageProxy | null> {
    const page = await this.getPage(sourceIndex);
    if (!page) {
      return null;
    }
    const entry = this.#pages.get(sourceIndex);
    if (!entry) {
      return null;
    }
    entry.refs += 1;
    this.#pinned.delete(sourceIndex);
    this.#removeIdle(sourceIndex);
    return page;
  }

  /** Decrement live consumers; idle pages stay until LRU budget eviction. */
  releasePageRef(sourceIndex: number): void {
    const entry = this.#pages.get(sourceIndex);
    if (!entry) {
      return;
    }
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0) {
      this.#touchIdle(sourceIndex);
      this.#evictIdle();
    }
  }

  /** Force-evict a page (used by close / tests). */
  releasePage(sourceIndex: number): void {
    const entry = this.#pages.get(sourceIndex);
    if (!entry) {
      return;
    }
    entry.page.cleanup();
    this.#pages.delete(sourceIndex);
    this.#pinned.delete(sourceIndex);
    this.#removeIdle(sourceIndex);
  }

  /** Test/helper: current retained page indexes. */
  cachedPageIndexes(): number[] {
    return [...this.#pages.keys()];
  }

  async close(): Promise<void> {
    const cachedIndexes = [...this.#pages.keys()];
    for (const sourceIndex of cachedIndexes) {
      this.releasePage(sourceIndex);
    }
    this.#idleOrder = [];
    this.#idleBudget = DEFAULT_PAGE_IDLE_CACHE;
    this.#pinned.clear();
    await this.#doc?.cleanup();
    await this.#loadingTask?.destroy();
    this.#doc = null;
    this.#loadingTask = null;
    this.bytes = null;
  }

  #touchIdle(sourceIndex: number): void {
    this.#removeIdle(sourceIndex);
    this.#idleOrder.push(sourceIndex);
  }

  #removeIdle(sourceIndex: number): void {
    const index = this.#idleOrder.indexOf(sourceIndex);
    if (index !== -1) {
      this.#idleOrder.splice(index, 1);
    }
  }

  #evictIdle(): void {
    while (this.#idleOrder.length > this.#idleBudget) {
      const oldest = this.#idleOrder.shift();
      if (oldest === undefined) {
        return;
      }
      // Pinned pages stay cached, but leave the idle list so they do not
      // consume the budget or trap this loop.
      if (this.#pinned.has(oldest)) {
        continue;
      }
      const entry = this.#pages.get(oldest);
      if (!entry || entry.refs > 0) {
        continue;
      }
      entry.page.cleanup();
      this.#pages.delete(oldest);
    }
  }
}

export const pdfSession = new PdfSession();

export const isPdfBytes = (bytes: Uint8Array): boolean => {
  if (bytes.length < 5) {
    return false;
  }
  const header = String.fromCodePoint(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
    bytes[3] ?? 0
  );
  return header === PDF_HEADER;
};

export const readFileBytes = async (file: File): Promise<Uint8Array> => {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
};
