import { normalizeRotation } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type { EditorPage } from "@/lib/editor/types";
import {
  DEFAULT_PDF_TEXT_COLOR,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
} from "@/lib/editor/types";
import { clonePdfBytes } from "@/lib/pdf/bytes";
import {
  extractPdfImageObjects,
  toPdfImageOps,
} from "@/lib/pdf/extract-images";
import {
  collectPdfFontFaces,
  extractPdfTextObjects,
  toExtractableTextContent,
} from "@/lib/pdf/extract-text";
import type { PdfJsFontObjectStore } from "@/lib/pdf/extract-text";
import {
  extractPdfTextPaints,
  toPdfTextColorOps,
  zipPdfTextItemPaints,
} from "@/lib/pdf/extract-text-colors";
import {
  extractPdfVectorObjects,
  toPdfVectorOps,
} from "@/lib/pdf/extract-vectors";
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

export const PDF_HEADER = "%PDF";

/** Matches mozilla/pdf.js PDFPageViewBuffer DEFAULT_CACHE_SIZE. */
export const DEFAULT_PAGE_IDLE_CACHE = 10;

interface PageCacheEntry {
  page: PDFPageProxy;
  refs: number;
}

class PdfSession {
  bytes: Uint8Array | null = null;
  #doc: PDFDocumentProxy | null = null;
  #loadingTask: PDFDocumentLoadingTask | null = null;
  #pages = new Map<number, PageCacheEntry>();
  /** Idle (refs === 0) source indexes, oldest first. */
  #idleOrder: number[] = [];
  #idleBudget = DEFAULT_PAGE_IDLE_CACHE;

  get document(): PDFDocumentProxy | null {
    return this.#doc;
  }

  /** Cap idle retained pages ≈ PDF.js `max(10, 2 * visible + 1)`. */
  setIdleCacheBudget(visibleCount: number): void {
    this.#idleBudget = Math.max(DEFAULT_PAGE_IDLE_CACHE, 2 * visibleCount + 1);
    this.#evictIdle();
  }

  async open(bytes: Uint8Array): Promise<EditorPage[]> {
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

    try {
      this.#doc = await this.#loadingTask.promise;
    } catch (error) {
      await this.close();
      if (error instanceof PasswordException) {
        throw new TypeError("This PDF is encrypted and cannot be opened.", {
          cause: error,
        });
      }
      throw error;
    }

    if (this.#doc.numPages > MAX_PDF_PAGES) {
      await this.close();
      throw new Error(`This PDF has more than ${MAX_PDF_PAGES} pages.`);
    }

    const pageNumbers = Array.from(
      { length: this.#doc.numPages },
      (_, index) => index + 1
    );
    const pages = await Promise.all(
      pageNumbers.map((number) => this.#doc?.getPage(number))
    );

    const editorPages = await Promise.all(
      pages.map(async (page, index) => {
        if (!page) {
          return null;
        }
        const viewport = page.getViewport({ scale: 1 });
        const { view } = page;
        const [textContent, operatorList] = await Promise.all([
          page.getTextContent(),
          page.getOperatorList({ annotationMode: AnnotationMode.DISABLE }),
        ]);
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
        const extractableText = toExtractableTextContent(textContent);
        // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
        const fontFaces = await collectPdfFontFaces(
          page.commonObjs as PdfJsFontObjectStore,
          extractableText.items
        );
        const textPaints = extractPdfTextPaints(
          operatorList,
          toPdfTextColorOps(OPS)
        );
        const { paints: itemPaints } = zipPdfTextItemPaints(
          extractableText.items,
          textPaints,
          DEFAULT_PDF_TEXT_COLOR
        );
        const editorPage = {
          cropBox,
          height: viewport.height,
          id,
          objects: [],
          pdfImageObjects: extractPdfImageObjects(
            operatorList,
            extractPage,
            toPdfImageOps(OPS)
          ),
          pdfTextObjects: extractPdfTextObjects(
            extractableText,
            extractPage,
            fontFaces,
            itemPaints
          ),
          pdfVectorObjects: extractPdfVectorObjects(
            operatorList,
            extractPage,
            toPdfVectorOps(OPS)
          ),
          rotation: 0,
          sourceIndex: index,
          sourceRotate,
          width: viewport.width,
        } satisfies EditorPage;
        page.cleanup();
        return editorPage;
      })
    );

    return editorPages.filter((page) => page !== null);
  }

  async getPage(sourceIndex: number): Promise<PDFPageProxy | null> {
    const cached = this.#pages.get(sourceIndex);
    if (cached) {
      return cached.page;
    }
    if (!this.#doc) {
      return null;
    }
    const page = await this.#doc.getPage(sourceIndex + 1);
    this.#pages.set(sourceIndex, { page, refs: 0 });
    this.#touchIdle(sourceIndex);
    this.#evictIdle();
    return page;
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
