import { PDFDict, PDFName, PDFStream, PDFString } from "pdf-lib";
import type { PDFDocument } from "pdf-lib";

/** Keys that carry editing history or a stale preview of the content. */
const HIDDEN_KEYS = ["Metadata", "Thumb", "PieceInfo", "LastModified"].map(
  (key) => PDFName.of(key)
);

/**
 * Strip data a reader never sees but a tool can pull out: XMP metadata,
 * thumbnails (a picture of the page before redaction) and application
 * private data on pages, XObjects and the catalog. The Info dictionary keeps
 * only the producer. Objects left unreachable go with the sweep.
 */
export const scrubHiddenData = (doc: PDFDocument): void => {
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
