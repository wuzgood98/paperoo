import { createId } from "@/lib/editor/ids";
import { clonePageWithFreshIds } from "@/lib/editor/page-clone";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";
import { ocrSession } from "@/lib/ocr/session";
import { blankDocId } from "@/lib/pdf/blank-pdf";
import { ensureBlankSource } from "@/lib/pdf/blank-source";

const pageAt = (pageId: string): { index: number; page: EditorPage } | null => {
  const { pages } = editorStore.getState().document;
  const index = pages.findIndex((page) => page.id === pageId);
  const page = pages[index];
  return page ? { index, page } : null;
};

/** Whether pages can be added now: a document is open and fully loaded. */
export const canInsertPages = (): boolean => {
  const { hydrated, status } = editorStore.getState();
  return status === "ready" && hydrated;
};

/** Insert a copy of `pageId` right after it; false when not possible yet. */
export const duplicatePage = (pageId: string): boolean => {
  const found = pageAt(pageId);
  if (!(found && canInsertPages())) {
    return false;
  }
  const copyId = createId();
  const ocrWordIds = ocrSession.clonePage(found.page.id, copyId);
  const copy = clonePageWithFreshIds(found.page, {
    ocrWordIds,
    pageId: copyId,
  });
  return editorStore.insertPages(found.index + 1, [copy]);
};

/**
 * Insert an empty page after `pageId`, the size that page is shown at
 * (its rotation included).
 */
export const insertBlankPageAfter = async (
  pageId: string
): Promise<boolean> => {
  const found = pageAt(pageId);
  if (!(found && canInsertPages())) {
    return false;
  }
  const { page } = found;
  const turned = page.rotation === 90 || page.rotation === 270;
  const width = turned ? page.height : page.width;
  const height = turned ? page.width : page.height;
  const template = await ensureBlankSource(blankDocId(width, height));
  // The document may have changed while the source opened.
  const current = pageAt(pageId);
  if (!current) {
    return false;
  }
  return editorStore.insertPages(current.index + 1, [
    { ...template, id: createId() },
  ]);
};
