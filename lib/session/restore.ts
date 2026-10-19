import { toastManager } from "@/components/ui/toast-manager";
import { pageDocId } from "@/lib/editor/page-source";
import { rebindRuntimeIds } from "@/lib/editor/session-rebind";
import { editorStore } from "@/lib/editor/store";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import type { EditorPage } from "@/lib/editor/types";
import { ocrSession } from "@/lib/ocr/session";
import { blankDocSize } from "@/lib/pdf/blank-pdf";
import { ensureBlankSource } from "@/lib/pdf/blank-source";
import { openRestoredPdf } from "@/lib/pdf/load-pdf";
import { pdfSession } from "@/lib/pdf/session";
import { indexedDbSessionStorage } from "@/lib/session/idb";
import { SESSION_TTL_MS, migrateMeta } from "@/lib/session/schema";
import type { PersistedMeta } from "@/lib/session/schema";
import { isSlotFree } from "@/lib/session/slot-lock";

const storage = indexedDbSessionStorage;

export const discardSavedSession = async (): Promise<void> => {
  try {
    await storage.clear();
  } catch {
    // Nothing to discard when storage is unavailable.
  }
};

/**
 * The saved session worth offering, if any: not expired, readable by this
 * version, and not still open in another tab.
 */
export const peekSavedSession = async (): Promise<PersistedMeta | null> => {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  let meta: PersistedMeta | null;
  try {
    meta = await storage.readMeta();
  } catch {
    return null;
  }
  if (!meta) {
    return null;
  }
  const current = migrateMeta(meta);
  if (!current || Date.now() - meta.savedAt > SESSION_TTL_MS) {
    await discardSavedSession();
    return null;
  }
  return (await isSlotFree()) ? current : null;
};

const restore = async (): Promise<boolean> => {
  const snapshot = await storage.readSnapshot();
  const meta = snapshot ? migrateMeta(snapshot.meta) : null;
  const source = snapshot?.sources.get(PRIMARY_DOC_ID);
  if (!snapshot || !meta || !source) {
    throw new Error("The saved session is incomplete.");
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  const opened = await openRestoredPdf(bytes, meta.fileName);
  if (!opened) {
    // A newer open replaced the restore.
    return false;
  }
  const byId = new Map(snapshot.pages.map((page) => [page.id, page]));
  const ordered: EditorPage[] = [];
  for (const id of meta.pageOrder) {
    const page = byId.get(id);
    if (!page) {
      throw new Error("A saved page is missing.");
    }
    ordered.push(page);
  }
  // Reopen every other source the pages use: inserted PDFs from their saved
  // bytes, blank pages from their id.
  const fresh = new Map<string, readonly EditorPage[]>([
    [PRIMARY_DOC_ID, opened.pages],
  ]);
  const otherSources = [
    ...new Set(ordered.map((page) => pageDocId(page))),
  ].filter((docId) => docId !== PRIMARY_DOC_ID);
  await Promise.all(
    otherSources.map(async (docId) => {
      if (blankDocSize(docId)) {
        await ensureBlankSource(docId);
        return;
      }
      const blob = snapshot.sources.get(docId);
      if (!blob) {
        throw new Error("A saved page comes from a PDF that wasn't saved.");
      }
      const added = await pdfSession.addDocument(
        new Uint8Array(await blob.arrayBuffer()),
        docId
      );
      fresh.set(docId, added.pages);
    })
  );
  const pages = rebindRuntimeIds(ordered, fresh);
  if (!pages) {
    throw new Error("The saved pages don't match the PDF.");
  }
  editorStore.revokeAssets();
  for (const asset of snapshot.assets) {
    editorStore.restoreAsset(asset.id, asset.bytes, asset.mimeType);
  }
  editorStore.restoreDocument(
    { form: meta.form ?? opened.form, pages },
    meta.fileName,
    meta.currentPageId
  );
  ocrSession.hydrate(meta.ocrWordsByPage);
  return true;
};

/** Reopen the saved session with its edits; false when it could not be. */
export const restoreSavedSession = async (): Promise<boolean> => {
  try {
    return await restore();
  } catch {
    await pdfSession.close();
    editorStore.clearDocument();
    await discardSavedSession();
    toastManager.add({
      description: "The saved copy couldn't be opened, so it was discarded.",
      title: "Couldn't restore that session",
      type: "error",
    });
    return false;
  }
};
