import { createId } from "@/lib/editor/ids";
import type { EditorStoreState } from "@/lib/editor/store";
import type {
  EditorDocument,
  EditorPage,
  ImageAsset,
} from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";
import {
  PRIMARY_SOURCE_ID,
  SESSION_SCHEMA_VERSION,
} from "@/lib/session/schema";
import type {
  PersistedAsset,
  SessionStorage,
  SessionWrite,
} from "@/lib/session/schema";

/** Quiet time after an edit before it is saved. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** Continuous editing still saves at least this often. */
export const AUTOSAVE_MAX_WAIT_MS = 10_000;

/** Headroom asked of the storage quota beyond the PDF itself. */
const QUOTA_HEADROOM_BYTES = 20 * 1024 * 1024;
const QUOTA_SOURCE_FACTOR = 1.2;

export interface AutosaveDeps {
  getAsset: (id: string) => ImageAsset | undefined;
  getState: () => EditorStoreState;
  isDirty: () => boolean;
  ocrWords: () => Readonly<Record<string, readonly OcrTextObject[]>>;
  /** Called once when autosave turns itself off for this document. */
  onDisabled: (reason: "quota" | "other-tab") => void;
  /** Free storage in bytes, or null when the browser cannot tell. */
  freeStorage: () => Promise<number | null>;
  /** Hold the single save slot; false when another tab holds it. */
  claimSlot: () => Promise<boolean>;
  releaseSlot: () => void;
  /** The open PDF's bytes; a new reference means a new document. */
  sourceBytes: () => Uint8Array | null;
  storage: SessionStorage;
  subscribe: (listener: () => void) => () => void;
}

/** Asset ids the document draws: overlay images and replaced PDF images. */
export const referencedAssetIds = (document: EditorDocument): Set<string> => {
  const ids = new Set<string>();
  for (const page of document.pages) {
    for (const object of page.objects) {
      if (object.type === "image") {
        ids.add(object.assetId);
      }
    }
    for (const image of page.pdfImageObjects) {
      if (image.replacementAssetId) {
        ids.add(image.replacementAssetId);
      }
    }
  }
  return ids;
};

/** A page as saved: preview images are provisional and rebuilt on restore. */
const persistablePage = (page: EditorPage): EditorPage =>
  page.pdfImageObjects.some((image) => image.previewAssetId !== null)
    ? {
        ...page,
        pdfImageObjects: page.pdfImageObjects.map((image) => ({
          ...image,
          previewAssetId: null,
        })),
      }
    : page;

/**
 * Save the open document's edits so a crash, reload or closed tab can be
 * restored. Saves only while the document has unexported edits, after a
 * quiet moment; clears the save once there is nothing left to lose.
 */
export const createAutosave = (deps: AutosaveDeps) => {
  /** The document being tracked, by its PDF bytes. */
  let sourceKey: Uint8Array | null = null;
  let sessionId = createId();
  /** True once this tab wrote the saved session for this document. */
  let owner = false;
  let disabled = false;
  /** Saved page references by id, to write only changed pages. */
  let savedPages = new Map<string, EditorPage>();
  let savedAssets = new Set<string>();
  let savedDocument: EditorDocument | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Writes run one after another. */
  let queue: Promise<void> = Promise.resolve();

  const cancelTimers = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = (async () => {
      await queue;
      await task();
    })();
    return queue;
  };

  const forgetSaved = (): void => {
    savedPages = new Map();
    savedAssets = new Set();
    savedDocument = null;
  };

  /** Drop this tab's saved session: nothing is left to lose. */
  const clearSaved = (): void => {
    if (!owner) {
      return;
    }
    owner = false;
    forgetSaved();
    void enqueue(async () => {
      try {
        await deps.storage.clear();
      } catch {
        // Storage is gone or full; the stale session expires on its own.
      }
      deps.releaseSlot();
    });
  };

  const disable = (reason: "quota" | "other-tab"): void => {
    disabled = true;
    cancelTimers();
    deps.onDisabled(reason);
  };

  const hasRoomFor = async (bytes: Uint8Array): Promise<boolean> => {
    const free = await deps.freeStorage();
    return (
      free === null ||
      free >= bytes.byteLength * QUOTA_SOURCE_FACTOR + QUOTA_HEADROOM_BYTES
    );
  };

  const buildWrite = (
    state: EditorStoreState,
    bytes: Uint8Array,
    reset: boolean
  ) => {
    const { document } = state;
    const putPages: EditorPage[] = [];
    for (const page of document.pages) {
      if (reset || savedPages.get(page.id) !== page) {
        putPages.push(persistablePage(page));
      }
    }
    const pageIds = new Set(document.pages.map((page) => page.id));
    const deletePageIds = reset
      ? []
      : [...savedPages.keys()].filter((id) => !pageIds.has(id));

    const assetIds = referencedAssetIds(document);
    const putAssets: PersistedAsset[] = [];
    for (const id of assetIds) {
      if (!reset && savedAssets.has(id)) {
        continue;
      }
      const asset = deps.getAsset(id);
      if (asset && !asset.provisional) {
        putAssets.push({ bytes: asset.bytes, id, mimeType: asset.mimeType });
      }
    }
    const deleteAssetIds = reset
      ? []
      : [...savedAssets].filter((id) => !assetIds.has(id));

    const write: SessionWrite = {
      deleteAssetIds,
      deletePageIds,
      meta: {
        assetIds: [...assetIds],
        currentPageId: state.currentPageId,
        fileName: state.fileName ?? "document.pdf",
        form: document.form,
        ocrWordsByPage: { ...deps.ocrWords() },
        pageOrder: document.pages.map((page) => page.id),
        savedAt: Date.now(),
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
        sources: [
          {
            byteLength: bytes.byteLength,
            docId: PRIMARY_SOURCE_ID,
            kind: "file",
          },
        ],
      },
      putAssets,
      putPages,
      reset,
    };
    if (reset) {
      write.source = {
        // A plain ArrayBuffer copy; the session's bytes may be any buffer.
        bytes: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        docId: PRIMARY_SOURCE_ID,
      };
    }
    return { assetIds, write };
  };

  const save = async (): Promise<void> => {
    cancelTimers();
    const state = deps.getState();
    const bytes = deps.sourceBytes();
    if (disabled || !bytes || bytes !== sourceKey || !deps.isDirty()) {
      return;
    }
    if (state.document === savedDocument) {
      return;
    }
    const reset = !owner;
    if (reset) {
      if (!(await deps.claimSlot())) {
        disable("other-tab");
        return;
      }
      if (!(await hasRoomFor(bytes))) {
        deps.releaseSlot();
        disable("quota");
        return;
      }
    }
    const { assetIds, write } = buildWrite(state, bytes, reset);
    try {
      await deps.storage.write(write);
    } catch {
      // QuotaExceededError, AbortError or a closed database: stop trying.
      owner = true;
      clearSaved();
      disable("quota");
      return;
    }
    owner = true;
    savedDocument = state.document;
    savedPages = new Map(state.document.pages.map((page) => [page.id, page]));
    savedAssets = assetIds;
  };

  const flush = (): Promise<void> => enqueue(save);

  const schedule = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
    maxWaitTimer ??= setTimeout(() => {
      void flush();
    }, AUTOSAVE_MAX_WAIT_MS);
  };

  const onChange = (): void => {
    const bytes = deps.sourceBytes();
    if (bytes !== sourceKey) {
      // Another document replaced this one, or it closed.
      cancelTimers();
      clearSaved();
      forgetSaved();
      sourceKey = bytes;
      sessionId = createId();
      disabled = false;
    }
    const state = deps.getState();
    if (!bytes || disabled || state.status !== "ready" || !state.hydrated) {
      return;
    }
    if (!deps.isDirty()) {
      cancelTimers();
      clearSaved();
      return;
    }
    if (state.document !== savedDocument) {
      schedule();
    }
  };

  const unsubscribe = deps.subscribe(onChange);
  onChange();

  return {
    /** Save pending edits now (page hidden or closing). */
    flush,
    stop: (): void => {
      cancelTimers();
      unsubscribe();
    },
  };
};

export type Autosave = ReturnType<typeof createAutosave>;
