import type { EditorPage } from "@/lib/editor/types";
import { blankDocSize, blankPdfBytes } from "@/lib/pdf/blank-pdf";
import { pdfSession } from "@/lib/pdf/session";

/** Each blank source's extracted page, by docId; shared while it opens. */
const templates = new Map<string, Promise<EditorPage>>();

const openBlankSource = async (docId: string): Promise<EditorPage> => {
  const size = blankDocSize(docId);
  if (!size) {
    throw new Error(`${docId} is not a blank page source.`);
  }
  const { pages } = await pdfSession.addDocument(
    blankPdfBytes(size.width, size.height),
    docId
  );
  const [page] = pages;
  if (!page) {
    throw new Error("The blank page could not be created.");
  }
  return page;
};

/**
 * Open the blank source `docId` once per open document and return its one
 * extracted page, to copy for each blank page of that size.
 */
export const ensureBlankSource = async (docId: string): Promise<EditorPage> => {
  let template = templates.get(docId);
  // Opening another file closes every source, blank ones included.
  if (template && !pdfSession.bytesOf(docId)) {
    template = undefined;
  }
  if (!template) {
    template = openBlankSource(docId);
    templates.set(docId, template);
  }
  try {
    return await template;
  } catch (error) {
    templates.delete(docId);
    throw error;
  }
};
