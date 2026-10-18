import { toastManager } from "@/components/ui/toast-manager";
import { editorStore } from "@/lib/editor/store";
import { ocrSession } from "@/lib/ocr/session";
import { pdfSession } from "@/lib/pdf/session";
import { createAutosave } from "@/lib/session/autosave";
import type { Autosave } from "@/lib/session/autosave";
import { indexedDbSessionStorage } from "@/lib/session/idb";
import { claimSlot, releaseSlot } from "@/lib/session/slot-lock";

const freeStorage = async (): Promise<number | null> => {
  if (!navigator.storage?.estimate) {
    return null;
  }
  try {
    const { quota, usage } = await navigator.storage.estimate();
    return quota === undefined ? null : quota - (usage ?? 0);
  } catch {
    return null;
  }
};

const onDisabled = (reason: "quota" | "other-tab"): void => {
  toastManager.add({
    description:
      reason === "quota"
        ? "There isn't enough browser storage to keep a copy of this PDF. Export to save your edits."
        : "Another Paperoo tab is autosaving its PDF. Export to save edits made here.",
    title: "Autosave is off",
    type: "warning",
  });
};

let autosave: Autosave | null = null;

/** Start saving the open document's edits in this browser. Idempotent. */
export const startAutosave = (): void => {
  if (autosave || typeof indexedDB === "undefined") {
    return;
  }
  autosave = createAutosave({
    claimSlot,
    freeStorage,
    getAsset: editorStore.getAsset,
    getState: editorStore.getState,
    isDirty: editorStore.isDirty,
    ocrWords: ocrSession.wordsForExport,
    onDisabled,
    releaseSlot,
    sourceBytes: () => pdfSession.bytes,
    storage: indexedDbSessionStorage,
    subscribe: editorStore.subscribe,
  });
  // Best effort: a hidden page may be closed without another event.
  const flush = (): void => {
    void autosave?.flush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });
  window.addEventListener("pagehide", flush);
};
