import type { EditorPage } from "@/lib/editor/types";
import { isPersistedMeta } from "@/lib/session/schema";
import type {
  PersistedAsset,
  PersistedMeta,
  SessionSnapshot,
  SessionStorage,
  SessionWrite,
} from "@/lib/session/schema";

const DB_NAME = "paperoo-session";
/** Object store layout; the saved data's shape is versioned in its meta. */
const DB_VERSION = 1;
const META_KEY = "last";

const STORES = ["meta", "pages", "assets", "sources"] as const;
type StoreName = (typeof STORES)[number];

const requestResult = async <T>(request: IDBRequest<T>): Promise<T> =>
  // oxlint-disable-next-line promise/avoid-new -- IndexedDB reports through request events
  await new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });

/** Settles when the transaction commits; rejects on error or abort. */
const transactionDone = async (transaction: IDBTransaction): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- IndexedDB reports through transaction events
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new DOMException("Aborted", "AbortError"))
    );
  });

let opening: Promise<IDBDatabase> | null = null;

const openDatabase = (): Promise<IDBDatabase> => {
  opening ??= (async () => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    });
    try {
      return await requestResult(request);
    } catch (error) {
      opening = null;
      throw error;
    }
  })();
  return opening;
};

const transaction = async (
  mode: IDBTransactionMode
): Promise<{
  store: (name: StoreName) => IDBObjectStore;
  tx: IDBTransaction;
}> => {
  const db = await openDatabase();
  // Frequent autosaves trade the last instant of durability for speed.
  const tx = db.transaction([...STORES], mode, { durability: "relaxed" });
  return { store: (name) => tx.objectStore(name), tx };
};

const readAll = async <T>(store: IDBObjectStore): Promise<T[]> =>
  // SAFETY: each store only ever holds values written as T below.
  (await requestResult(store.getAll())) as T[];

export const indexedDbSessionStorage: SessionStorage = {
  clear: async () => {
    const { store, tx } = await transaction("readwrite");
    for (const name of STORES) {
      store(name).clear();
    }
    await transactionDone(tx);
  },

  readMeta: async () => {
    const { store } = await transaction("readonly");
    const meta: unknown = await requestResult(store("meta").get(META_KEY));
    return isPersistedMeta(meta) ? meta : null;
  },

  readSnapshot: async (): Promise<SessionSnapshot | null> => {
    const { store, tx } = await transaction("readonly");
    const metaRequest = store("meta").get(META_KEY);
    const pagesRequest = readAll<EditorPage>(store("pages"));
    const assetsRequest = readAll<PersistedAsset>(store("assets"));
    const sourcesStore = store("sources");
    const sourceKeys = requestResult(sourcesStore.getAllKeys());
    const sourceValues = readAll<Blob>(sourcesStore);
    const [meta, pages, assets, keys, blobs] = await Promise.all([
      requestResult(metaRequest),
      pagesRequest,
      assetsRequest,
      sourceKeys,
      sourceValues,
    ]);
    await transactionDone(tx);
    if (!isPersistedMeta(meta)) {
      return null;
    }
    const sources = new Map<string, Blob>();
    for (const [index, key] of keys.entries()) {
      const blob = blobs[index];
      if (blob) {
        sources.set(String(key), blob);
      }
    }
    return { assets, meta: meta satisfies PersistedMeta, pages, sources };
  },

  write: async (change: SessionWrite) => {
    const { store, tx } = await transaction("readwrite");
    if (change.reset) {
      for (const name of STORES) {
        store(name).clear();
      }
    }
    if (change.source) {
      store("sources").put(change.source.bytes, change.source.docId);
    }
    for (const page of change.putPages) {
      store("pages").put(page, page.id);
    }
    for (const id of change.deletePageIds) {
      store("pages").delete(id);
    }
    for (const asset of change.putAssets) {
      store("assets").put(asset, asset.id);
    }
    for (const id of change.deleteAssetIds) {
      store("assets").delete(id);
    }
    store("meta").put(change.meta, META_KEY);
    await transactionDone(tx);
  },
};
