import { createId } from "@/lib/editor/ids";
import { canInsertPages } from "@/lib/editor/page-actions";
import { editorStore } from "@/lib/editor/store";
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_TOTAL_SOURCE_BYTES,
} from "@/lib/editor/types";
import { mergeEmbeddedFontGlyphs } from "@/lib/pdf/embedded-font";
import { isPdfBytes, pdfSession, readFileBytes } from "@/lib/pdf/session";

/** Source document ids of inserted PDFs start with this. */
export const FILE_DOC_PREFIX = "file:";

const MEGABYTE = 1024 * 1024;

/**
 * Open `bytes` as another source document and insert all its pages at
 * `atIndex`, with its form fields, as one undo step. Returns how many pages
 * were inserted; throws with a message for the user when it cannot.
 */
export const insertPdfBytes = async (
  bytes: Uint8Array,
  atIndex: number
): Promise<number> => {
  if (!canInsertPages()) {
    throw new Error("Wait for every page to load, then try again.");
  }
  if (!isPdfBytes(bytes)) {
    throw new Error("That file does not look like a valid PDF.");
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `That PDF is larger than the ${MAX_PDF_BYTES / MEGABYTE} MB limit.`
    );
  }
  if (pdfSession.totalBytes() + bytes.byteLength > MAX_TOTAL_SOURCE_BYTES) {
    throw new Error(
      `All files together can be at most ${MAX_TOTAL_SOURCE_BYTES / MEGABYTE} MB.`
    );
  }

  const docId = `${FILE_DOC_PREFIX}${createId()}`;
  // pdf.js takes ownership of what it opens; leave the caller's bytes alone.
  const { form, pages } = await pdfSession.addDocument(
    Uint8Array.from(bytes),
    docId
  );
  const refuse = async (message: string): Promise<never> => {
    await pdfSession.closeDocument(docId);
    throw new Error(message);
  };
  if (form.hasXfa) {
    return await refuse("PDFs with XFA forms can't be inserted.");
  }
  const pageCount = editorStore.getState().document.pages.length;
  if (pageCount + pages.length > MAX_PDF_PAGES) {
    return await refuse(
      `A document can have at most ${MAX_PDF_PAGES} pages; this PDF has ${pages.length}.`
    );
  }
  const inserted = editorStore.insertPages(
    atIndex,
    mergeEmbeddedFontGlyphs(pages),
    {
      ...form,
      fields: form.fields.map((field) => ({ ...field, docId })),
    }
  );
  if (!inserted) {
    return await refuse("Wait for every page to load, then try again.");
  }
  return pages.length;
};

/** Insert a PDF file's pages at `atIndex`; see `insertPdfBytes`. */
export const insertPdfFile = async (
  file: File,
  atIndex: number
): Promise<number> => {
  if (file.type && file.type !== "application/pdf") {
    throw new Error("That file is not a PDF.");
  }
  return await insertPdfBytes(await readFileBytes(file), atIndex);
};
