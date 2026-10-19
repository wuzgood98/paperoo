import type {
  EditorPage,
  ImageMimeType,
  PdfFormModel,
} from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";

/**
 * Shape of a saved session. Bump it, and add a migration from the previous
 * version, whenever a persisted type changes shape.
 */
export const SESSION_SCHEMA_VERSION = 1;

/** Saved sessions older than this are not offered. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A source document; blank ones are rebuilt from their id, not stored. */
export interface PersistedSource {
  byteLength: number;
  docId: string;
  kind: "blank" | "file";
}

export interface PersistedMeta {
  assetIds: string[];
  currentPageId: string | null;
  fileName: string;
  form?: PdfFormModel;
  ocrWordsByPage: Record<string, readonly OcrTextObject[]>;
  pageOrder: string[];
  savedAt: number;
  schemaVersion: number;
  sessionId: string;
  sources: PersistedSource[];
}

export interface PersistedAsset {
  bytes: Uint8Array;
  id: string;
  mimeType: ImageMimeType;
}

/** One autosave: everything changed since the last one. */
export interface SessionWrite {
  deleteAssetIds: string[];
  deletePageIds: string[];
  meta: PersistedMeta;
  putAssets: PersistedAsset[];
  putPages: EditorPage[];
  /** Start a new saved session: drop whatever was saved before. */
  reset: boolean;
  /** Source PDFs not saved yet (each is written once per session). */
  putSources: { bytes: Blob; docId: string }[];
  /** Saved source PDFs no page uses any more. */
  deleteSourceIds: string[];
}

export interface SessionSnapshot {
  assets: PersistedAsset[];
  meta: PersistedMeta;
  pages: EditorPage[];
  sources: Map<string, Blob>;
}

/** Where sessions are saved; IndexedDB in the browser, memory in tests. */
export interface SessionStorage {
  clear: () => Promise<void>;
  readMeta: () => Promise<PersistedMeta | null>;
  readSnapshot: () => Promise<SessionSnapshot | null>;
  write: (change: SessionWrite) => Promise<void>;
}

type Migration = (meta: PersistedMeta) => PersistedMeta;

/** Upgrades from each older schema version to the next one. */
const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/* oxlint-disable anti-slop/no-runtime-typeof -- IndexedDB records are I/O: check them before use */
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Structural check of a stored meta record before trusting it. */
export const isPersistedMeta = (value: unknown): value is PersistedMeta => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // SAFETY: a non-null object; every field read below is checked.
  const meta = value as Partial<PersistedMeta>;
  return (
    typeof meta.schemaVersion === "number" &&
    typeof meta.sessionId === "string" &&
    typeof meta.fileName === "string" &&
    typeof meta.savedAt === "number" &&
    isStringArray(meta.pageOrder) &&
    isStringArray(meta.assetIds) &&
    Array.isArray(meta.sources)
  );
};
/* oxlint-enable anti-slop/no-runtime-typeof */

/** The meta upgraded to the current schema, or null when it cannot be. */
export const migrateMeta = (meta: PersistedMeta): PersistedMeta | null => {
  let current = meta;
  while (current.schemaVersion < SESSION_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[current.schemaVersion];
    if (!migrate) {
      return null;
    }
    current = migrate(current);
  }
  return current.schemaVersion === SESSION_SCHEMA_VERSION ? current : null;
};
