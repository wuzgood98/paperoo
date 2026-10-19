import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNull,
  PDFRef,
  PDFStream,
} from "pdf-lib";
import type { PDFDocument, PDFObject } from "pdf-lib";

export interface SweepResult {
  /** Objects written to the context but reachable from nothing. */
  deleted: number;
  /** Refs to a page dict outside the page tree, nulled out. */
  hiddenPageEdges: number;
}

const isPageDict = (object: PDFObject | undefined): boolean =>
  object instanceof PDFDict &&
  object.get(PDFName.of("Type")) === PDFName.of("Page");

/**
 * Delete every object the trailer cannot reach. pdf-lib writes every object
 * registered in its context, so text removed from a page, a pruned field or
 * a replaced content stream would otherwise ship as an orphan.
 *
 * A ref to a page dict that is not in the page tree is a hidden page copy
 * (the copier maps objects, not refs, so a link to a copied page copies the
 * page again). Those refs are nulled instead of followed, so the copy and the
 * content it carries go too.
 */
export const sweepUnreachable = (doc: PDFDocument): SweepResult => {
  const { context } = doc;
  const inTree = new Set<PDFRef>(doc.getPages().map((page) => page.ref));
  const reached = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  let hiddenPageEdges = 0;

  /** The object to keep in this slot: the ref, or null for a hidden page. */
  const visit = (value: PDFObject): PDFObject => {
    if (!(value instanceof PDFRef)) {
      if (
        value instanceof PDFDict ||
        value instanceof PDFArray ||
        value instanceof PDFStream
      ) {
        stack.push(value);
      }
      return value;
    }
    if (reached.has(value)) {
      return value;
    }
    const target = context.lookup(value);
    if (!inTree.has(value) && isPageDict(target)) {
      hiddenPageEdges += 1;
      return PDFNull;
    }
    reached.add(value);
    if (target) {
      stack.push(target);
    }
    return value;
  };

  const { Encrypt, ID, Info, Root } = context.trailerInfo;
  for (const root of [Root, Info, Encrypt, ID]) {
    if (root) {
      visit(root);
    }
  }
  for (let next = stack.pop(); next; next = stack.pop()) {
    const container = next instanceof PDFStream ? next.dict : next;
    if (container instanceof PDFDict) {
      for (const [key, value] of container.entries()) {
        const kept = visit(value);
        if (kept === PDFNull) {
          container.delete(key);
        }
      }
    } else if (container instanceof PDFArray) {
      for (let index = 0; index < container.size(); index += 1) {
        const value = container.get(index);
        const kept = visit(value);
        if (kept !== value) {
          container.set(index, kept);
        }
      }
    }
  }

  let deleted = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref)) {
      context.delete(ref);
      deleted += 1;
    }
  }
  return { deleted, hiddenPageEdges };
};

/**
 * Save with nothing unreachable in the file. Fonts and images are embedded
 * first (the flush), so the sweep sees their objects; the save's own flush
 * then has nothing left to add.
 */
export const saveSwept = async (doc: PDFDocument): Promise<Uint8Array> => {
  await doc.flush();
  sweepUnreachable(doc);
  return doc.save({ updateFieldAppearances: false });
};
