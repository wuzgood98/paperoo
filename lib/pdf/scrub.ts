import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFFlateStream,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
} from "pdf-lib";
import type { PDFDocument, PDFObject, PDFPage } from "pdf-lib";

import { withXObjects } from "@/lib/pdf/content-redaction";
import { latin1 } from "@/lib/pdf/content-stream";

/** Keys that carry editing history or a stale preview of the content. */
const HIDDEN_KEYS = ["Metadata", "Thumb", "PieceInfo", "LastModified"].map(
  (key) => PDFName.of(key)
);

/** One content stream's text, from the source file or written by Paperoo. */
const streamContent = (stream: PDFObject | undefined): string | null => {
  if (stream instanceof PDFRawStream) {
    return latin1(decodePDFRawStream(stream).decode());
  }
  if (stream instanceof PDFFlateStream) {
    return latin1(stream.getUnencodedContents());
  }
  return null;
};

/** The page's content streams joined, or null if one cannot be read. */
const pageContent = (page: PDFPage): string | null => {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((_, index) => contents.lookup(index))
      : [contents];
  try {
    const parts = streams.map(streamContent);
    return parts.includes(null) ? null : parts.join("\n");
  } catch {
    return null;
  }
};

/**
 * Give each page resources of its own that hold only what its content
 * uses. Pages often share one resource dictionary, so an image or font
 * drawn only where a redaction removed it would stay in the file through
 * the other pages.
 */
const keepUsedResources = (doc: PDFDocument): void => {
  for (const page of doc.getPages()) {
    const content = pageContent(page);
    if (content !== null) {
      page.node.set(
        PDFName.of("Resources"),
        withXObjects(doc, page.node.Resources(), new Map(), content)
      );
    }
  }
};

/**
 * Strip data a reader never sees but a tool can pull out: XMP metadata,
 * thumbnails (a picture of the page before redaction), application
 * private data on pages, XObjects and the catalog, and resources no page
 * uses. The Info dictionary keeps only the producer. Objects left
 * unreachable go with the sweep.
 */
export const scrubHiddenData = (doc: PDFDocument): void => {
  keepUsedResources(doc);
  const pageType = PDFName.of("Page");
  const xObjectType = PDFName.of("XObject");
  const typeKey = PDFName.of("Type");
  const subtypeKey = PDFName.of("Subtype");
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFStream ? object.dict : object;
    if (!(dict instanceof PDFDict)) {
      continue;
    }
    const type = dict.get(typeKey);
    const subtype = dict.get(subtypeKey);
    const isXObject =
      type === xObjectType ||
      subtype === PDFName.of("Image") ||
      subtype === PDFName.of("Form");
    if (type === pageType || isXObject) {
      for (const key of HIDDEN_KEYS) {
        dict.delete(key);
      }
    }
  }
  for (const key of HIDDEN_KEYS) {
    doc.catalog.delete(key);
  }
  doc.context.trailerInfo.Info = doc.context.register(
    doc.context.obj({ Producer: PDFString.of("Paperoo") })
  );
};
