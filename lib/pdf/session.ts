import { normalizeRotation } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import { pageKeyString } from "@/lib/editor/page-source";
import type { PageKey } from "@/lib/editor/page-source";
import type {
  EditorPage,
  PdfAnnotationObject,
  PdfFormModel,
} from "@/lib/editor/types";
import {
  DEFAULT_PDF_TEXT_COLOR,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  PRIMARY_DOC_ID,
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
  PDFJS_DOCUMENT_PARAMS,
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
import { sliceType3Glyphs } from "@/lib/pdf/type3-glyphs";

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

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- pdf.js link destination I/O */
/** The page a destination names, as a 0-based index; null when unknown. */
const destinationPageIndex = async (
  doc: PDFDocumentProxy,
  dest: unknown
): Promise<number | null> => {
  try {
    const explicit =
      typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) {
      return null;
    }
    const [target] = explicit;
    if (typeof target === "number") {
      return target;
    }
    if (
      target &&
      typeof target === "object" &&
      "num" in target &&
      "gen" in target
    ) {
      // SAFETY: pdf.js encodes explicit destination pages as { num, gen } refs.
      return await doc.getPageIndex(target as { gen: number; num: number });
    }
  } catch {
    // A broken destination simply goes nowhere.
  }
  return null;
};

/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

/**
 * Resolve each internal link's target to a page index within its document,
 * so navigation does not depend on pdf.js object numbers.
 */
const resolveLinkTargets = async (
  doc: PDFDocumentProxy,
  objects: PdfAnnotationObject[]
): Promise<PdfAnnotationObject[]> =>
  await Promise.all(
    objects.map(async (object) => {
      if (object.type !== "pdf-link" || object.action.kind !== "goto") {
        return object;
      }
      const pageIndex = await destinationPageIndex(doc, object.action.dest);
      return pageIndex === null
        ? object
        : { ...object, action: { ...object.action, pageIndex } };
    })
  );

/** Destroy `loadingTask` once `previous` settles; never rejects. */
const destroyAfter = async (
  previous: Promise<void>,
  loadingTask: PDFDocumentLoadingTask | null
): Promise<void> => {
  await previous;
  try {
    await loadingTask?.destroy();
  } catch {
    // The document is already detached; nothing is left to recover.
  }
};

interface SourceEntry {
  bytes: Uint8Array;
  doc: PDFDocumentProxy | null;
  loadingTask: PDFDocumentLoadingTask;
}

class PdfSession {
  /** Open source documents by id; the opened file is PRIMARY_DOC_ID. */
  #sources = new Map<string, SourceEntry>();
  /** Cached pages by `pageKeyString`. */
  #pages = new Map<string, PageCacheEntry>();
  /** Idle (refs === 0) page keys, oldest first. */
  #idleOrder: string[] = [];
  #idleBudget = DEFAULT_PAGE_IDLE_CACHE;
  /**
   * First-paint keys kept out of LRU until `retainPage` takes a live ref.
   * Hydration would otherwise evict them before the viewport chunk loads.
   */
  #pinned = new Set<string>();
  /** Settles once every closed document has finished tearing down. */
  #teardown: Promise<void> = Promise.resolve();
  /** Bumped per primary open so a superseded open stops before loading. */
  #openGeneration = 0;
  /** Bumped whenever the set of open documents changes; keys caches. */
  #generation = 0;

  get generation(): number {
    return this.#generation;
  }

  /** The bytes a source document was opened from, if it is open. */
  bytesOf(docId: string): Uint8Array | null {
    return this.#sources.get(docId)?.bytes ?? null;
  }

  documentOf(docId: string): PDFDocumentProxy | null {
    return this.#sources.get(docId)?.doc ?? null;
  }

  /** Ids of the open source documents. */
  docIds(): string[] {
    return [...this.#sources.keys()];
  }

  #isCurrent(docId: string, doc: PDFDocumentProxy): boolean {
    return this.#sources.get(docId)?.doc === doc;
  }

  /** Cap idle retained pages ≈ PDF.js `max(10, 2 * visible + 1)`. */
  setIdleCacheBudget(visibleCount: number): void {
    this.#idleBudget = Math.max(DEFAULT_PAGE_IDLE_CACHE, 2 * visibleCount + 1);
    this.#evictIdle();
  }

  async open(
    bytes: Uint8Array
  ): Promise<{ form: PdfFormModel; pages: EditorPage[] }> {
    const doc = await this.#openPrimary(bytes);
    // Doc-level probes are page-independent: start them before the page loop
    // so worker round-trips overlap page extraction instead of tailing it.
    const formProbes = startFormProbes(doc);
    observeRejection(formProbes);
    const built = await this.#loadPageRange(
      PRIMARY_DOC_ID,
      doc,
      0,
      doc.numPages
    );
    if (!this.#isCurrent(PRIMARY_DOC_ID, doc)) {
      throw new Error("This PDF is no longer open.");
    }
    const probes = await formProbes;
    if (!this.#isCurrent(PRIMARY_DOC_ID, doc)) {
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
    const doc = await this.#openPrimary(bytes);
    const cancelled = handlers.isCancelled ?? ((): boolean => false);
    const isGone = (): boolean =>
      cancelled() || !this.#isCurrent(PRIMARY_DOC_ID, doc);
    const formProbes = startFormProbes(doc);
    observeRejection(formProbes);
    const totalPages = doc.numPages;
    if (totalPages === 0) {
      throw new Error("This PDF has no pages.");
    }
    const firstCount = Math.min(FIRST_PAINT_PAGES, totalPages);
    const first = await this.#loadPageRange(PRIMARY_DOC_ID, doc, 0, firstCount);
    if (isGone()) {
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
    if (!hydrated || isGone()) {
      return { pageCount: totalPages };
    }
    const probes = await formProbes;
    if (isGone()) {
      return { pageCount: totalPages };
    }
    handlers.onForm(formFromBuilt(doc, allBuilt, probes));
    return { pageCount: totalPages };
  }

  /**
   * Open another source document beside the open ones (a merged file, a
   * blank page) and extract all of its pages, stamped with `docId`.
   */
  async addDocument(
    bytes: Uint8Array,
    docId: string
  ): Promise<{ form: PdfFormModel; pages: EditorPage[] }> {
    if (this.#sources.has(docId)) {
      throw new Error(`Source document ${docId} is already open.`);
    }
    const doc = await this.#openSource(bytes, docId);
    const formProbes = startFormProbes(doc);
    observeRejection(formProbes);
    const built = await this.#loadPageRange(docId, doc, 0, doc.numPages);
    const probes = await formProbes;
    if (!this.#isCurrent(docId, doc)) {
      throw new Error("This PDF is no longer open.");
    }
    return {
      form: formFromBuilt(doc, built, probes),
      pages: built.map((entry) => entry.editorPage),
    };
  }

  /** Close every open document, then open `bytes` as the opened file. */
  async #openPrimary(bytes: Uint8Array): Promise<PDFDocumentProxy> {
    this.#openGeneration += 1;
    const generation = this.#openGeneration;
    await this.close();
    if (generation !== this.#openGeneration) {
      throw new Error("This PDF is no longer open.");
    }
    return this.#openSource(bytes, PRIMARY_DOC_ID);
  }

  async #openSource(
    bytes: Uint8Array,
    docId: string
  ): Promise<PDFDocumentProxy> {
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new Error("This PDF is larger than the 80 MB limit.");
    }
    ensurePdfjsWorker();
    // pdf.js takes ownership of `bytes`; the session keeps its own copy.
    const kept = clonePdfBytes(bytes);
    const loadingTask = getDocument({ ...PDFJS_DOCUMENT_PARAMS, data: bytes });
    const entry: SourceEntry = { bytes: kept, doc: null, loadingTask };
    this.#sources.set(docId, entry);
    this.#generation += 1;

    let doc: PDFDocumentProxy;
    try {
      doc = await loadingTask.promise;
    } catch (error) {
      // A newer open may already own the session; only tear down our own task.
      if (this.#sources.get(docId) === entry) {
        await this.#closeSource(docId);
      }
      if (error instanceof PasswordException) {
        throw new TypeError("This PDF is encrypted and cannot be opened.", {
          cause: error,
        });
      }
      throw error;
    }
    if (this.#sources.get(docId) !== entry) {
      throw new Error("This PDF is no longer open.");
    }

    entry.doc = doc;
    if (doc.numPages > MAX_PDF_PAGES) {
      await this.#closeSource(docId);
      throw new Error(`This PDF has more than ${MAX_PDF_PAGES} pages.`);
    }
    return doc;
  }

  /** Keep the first window resident until a canvas retains it. */
  #pinFirstWindow(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const key = pageKeyString({ docId: PRIMARY_DOC_ID, sourceIndex: index });
      if (this.#pages.has(key)) {
        this.#pinned.add(key);
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
    const isGone = (): boolean =>
      cancelled() || !this.#isCurrent(PRIMARY_DOC_ID, doc);
    if (!this.#isCurrent(PRIMARY_DOC_ID, doc)) {
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
      if (isGone()) {
        return false;
      }
      const end = Math.min(start + OPEN_PAGE_CONCURRENCY, totalPages);
      // oxlint-disable-next-line eslint/no-await-in-loop -- bounded sequential hydration chunks keep the UI responsive
      const chunk = await this.#loadPageRange(PRIMARY_DOC_ID, doc, start, end);
      if (isGone()) {
        return false;
      }
      allBuilt.push(...chunk);
      handlers.onMorePages(chunk.map((entry) => entry.editorPage));
      // Yield between chunks to keep scrolling/editing responsive.
      // oxlint-disable-next-line eslint/no-await-in-loop -- bounded sequential hydration chunks keep the UI responsive
      await yieldToUI();
    }
    return !isGone();
  }

  /** Extract [start, end) with bounded concurrency, preserving order. */
  async #loadPageRange(
    docId: string,
    doc: PDFDocumentProxy,
    start: number,
    end: number
  ): Promise<BuiltPage[]> {
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
          this.#loadPage(docId, doc, chunkStart + offset)
        )
      );
      for (const [offset, entry] of chunk.entries()) {
        results[chunkStart - start + offset] = entry;
      }
    }
    return results.filter((entry): entry is BuiltPage => entry !== null);
  }

  /** Fetch, extract, and cache a single page for later render reuse. */
  async #loadPage(
    docId: string,
    doc: PDFDocumentProxy,
    sourceIndex: number
  ): Promise<BuiltPage | null> {
    if (!this.#isCurrent(docId, doc)) {
      return null;
    }
    let page: PDFPageProxy;
    try {
      page = await doc.getPage(sourceIndex + 1);
    } catch {
      return null;
    }
    if (!this.#cachePage(docId, doc, sourceIndex, page)) {
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
      if (!this.#isCurrent(docId, doc)) {
        return null;
      }
      throw error;
    }
    if (!this.#isCurrent(docId, doc)) {
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
    const { objects: extractedAnnotations, skippedSubtypes } =
      extractPdfAnnotationObjects(rawAnnotations, extractPage);
    const pdfAnnotationObjects = await resolveLinkTargets(
      doc,
      extractedAnnotations
    );
    if (!this.#isCurrent(docId, doc)) {
      return null;
    }
    const extractableText = toExtractableTextContent(textContent);
    // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
    const fontFaces = await collectPdfFontFaces(
      page.commonObjs as PdfJsFontObjectStore,
      extractableText.items,
      TYPE3_METRIC_OPS
    );
    if (!this.#isCurrent(docId, doc)) {
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
    const editorPage: EditorPage = {
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
      type3Glyphs: sliceType3Glyphs(operatorList, OPS, fontFaces),
      width: viewport.width,
    };
    // Pages of the opened file leave it unset, as saved sessions did.
    if (docId !== PRIMARY_DOC_ID) {
      editorPage.docId = docId;
    }
    page.cleanup();
    return { editorPage, rawAnnotations };
  }

  async getPage(key: PageKey): Promise<PDFPageProxy | null> {
    const cached = this.#pages.get(pageKeyString(key));
    if (cached) {
      return cached.page;
    }
    const doc = this.documentOf(key.docId);
    if (!doc) {
      return null;
    }
    const page = await doc.getPage(key.sourceIndex + 1);
    if (!this.#cachePage(key.docId, doc, key.sourceIndex, page)) {
      return null;
    }
    return page;
  }

  /**
   * Cache `page` only while `doc` is still open under `docId`.
   * A superseded open's continuation must not put a destroyed proxy back.
   */
  #cachePage(
    docId: string,
    doc: PDFDocumentProxy,
    sourceIndex: number,
    page: PDFPageProxy
  ): boolean {
    if (!this.#isCurrent(docId, doc)) {
      return false;
    }
    const key = pageKeyString({ docId, sourceIndex });
    // Two consumers can load the same uncached page at once (the canvas and
    // its thumbnail). Keep the first entry: replacing it would drop the
    // refs already taken, and the page could be evicted while still drawn.
    if (this.#pages.has(key)) {
      return true;
    }
    this.#pages.set(key, { page, refs: 0 });
    this.#touchIdle(key);
    this.#evictIdle();
    return true;
  }

  /** Load (or reuse) a page and increment its live consumer count. */
  async retainPage(key: PageKey): Promise<PDFPageProxy | null> {
    const page = await this.getPage(key);
    if (!page) {
      return null;
    }
    const cacheKey = pageKeyString(key);
    const entry = this.#pages.get(cacheKey);
    if (!entry) {
      return null;
    }
    entry.refs += 1;
    this.#pinned.delete(cacheKey);
    this.#removeIdle(cacheKey);
    return page;
  }

  /** Decrement live consumers; idle pages stay until LRU budget eviction. */
  releasePageRef(key: PageKey): void {
    const cacheKey = pageKeyString(key);
    const entry = this.#pages.get(cacheKey);
    if (!entry) {
      return;
    }
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0) {
      this.#touchIdle(cacheKey);
      this.#evictIdle();
    }
  }

  /** Force-evict a page (used by close / tests). */
  releasePage(key: PageKey): void {
    this.#dropPage(pageKeyString(key));
  }

  #dropPage(cacheKey: string): void {
    const entry = this.#pages.get(cacheKey);
    if (!entry) {
      return;
    }
    entry.page.cleanup();
    this.#pages.delete(cacheKey);
    this.#pinned.delete(cacheKey);
    this.#removeIdle(cacheKey);
  }

  /** Close one source document that the pages no longer use. */
  closeDocument(docId: string): Promise<void> {
    if (docId === PRIMARY_DOC_ID) {
      return this.close();
    }
    return this.#closeSource(docId);
  }

  /** Bytes of every open source document, for size limits. */
  totalBytes(): number {
    let total = 0;
    for (const entry of this.#sources.values()) {
      total += entry.bytes.byteLength;
    }
    return total;
  }

  /** Test/helper: retained page indexes of one source document. */
  cachedPageIndexes(docId: string = PRIMARY_DOC_ID): number[] {
    const prefix = `${docId}#`;
    const indexes: number[] = [];
    for (const key of this.#pages.keys()) {
      if (key.startsWith(prefix)) {
        indexes.push(Number(key.slice(prefix.length)));
      }
    }
    return indexes;
  }

  /** Detach one source document and destroy it once earlier teardowns finish. */
  #closeSource(docId: string): Promise<void> {
    const entry = this.#sources.get(docId);
    if (!entry) {
      return this.#teardown;
    }
    const prefix = `${docId}#`;
    for (const key of this.#pages.keys()) {
      if (key.startsWith(prefix)) {
        this.#dropPage(key);
      }
    }
    this.#sources.delete(docId);
    this.#generation += 1;
    // destroy() cancels renders still in flight; doc.cleanup() would throw
    // "Page N is currently rendering" on them instead. A failed teardown of
    // the old document must never fail the open that replaces it.
    this.#teardown = destroyAfter(this.#teardown, entry.loadingTask);
    return this.#teardown;
  }

  /**
   * Detach every open document synchronously, then destroy them. Every close
   * joins one teardown chain, so a concurrent open waits for the previous
   * documents to finish tearing down before it touches the shared worker.
   */
  close(): Promise<void> {
    for (const docId of this.#sources.keys()) {
      void this.#closeSource(docId);
    }
    for (const key of this.#pages.keys()) {
      this.#dropPage(key);
    }
    this.#idleOrder = [];
    this.#idleBudget = DEFAULT_PAGE_IDLE_CACHE;
    this.#pinned.clear();
    return this.#teardown;
  }

  #touchIdle(cacheKey: string): void {
    this.#removeIdle(cacheKey);
    this.#idleOrder.push(cacheKey);
  }

  #removeIdle(cacheKey: string): void {
    const index = this.#idleOrder.indexOf(cacheKey);
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
