import { normalizeRotation } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type { EditorPage } from "@/lib/editor/types";
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from "@/lib/editor/types";
import { clonePdfBytes } from "@/lib/pdf/bytes";
import {
  ensurePdfjsWorker,
  getDocument,
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

interface PageCacheEntry {
  page: PDFPageProxy;
}

class PdfSession {
  bytes: Uint8Array | null = null;
  #doc: PDFDocumentProxy | null = null;
  #loadingTask: PDFDocumentLoadingTask | null = null;
  #pages = new Map<number, PageCacheEntry>();

  get document(): PDFDocumentProxy | null {
    return this.#doc;
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

    return pages.flatMap((page, index) => {
      if (!page) {
        return [];
      }
      const viewport = page.getViewport({ scale: 1 });
      const { view } = page;
      page.cleanup();
      return [
        {
          cropBox: {
            height: view[3] - view[1],
            width: view[2] - view[0],
            x: view[0],
            y: view[1],
          },
          height: viewport.height,
          id: createId(),
          objects: [],
          rotation: 0,
          sourceIndex: index,
          sourceRotate: normalizeRotation(page.rotate),
          width: viewport.width,
        } satisfies EditorPage,
      ];
    });
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
    this.#pages.set(sourceIndex, { page });
    return page;
  }

  releasePage(sourceIndex: number): void {
    const entry = this.#pages.get(sourceIndex);
    if (!entry) {
      return;
    }
    entry.page.cleanup();
    this.#pages.delete(sourceIndex);
  }

  async close(): Promise<void> {
    const cachedIndexes = [...this.#pages.keys()];
    for (const sourceIndex of cachedIndexes) {
      this.releasePage(sourceIndex);
    }
    await this.#doc?.cleanup();
    await this.#loadingTask?.destroy();
    this.#doc = null;
    this.#loadingTask = null;
    this.bytes = null;
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
