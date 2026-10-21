import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { editorStore } from "@/lib/editor/store";
import type { EditorPage, ImageObject, TextObject } from "@/lib/editor/types";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  createAutosave,
} from "@/lib/session/autosave";
import type { Autosave, AutosaveDeps } from "@/lib/session/autosave";
import {
  SESSION_SCHEMA_VERSION,
  isPersistedMeta,
  migrateMeta,
} from "@/lib/session/schema";
import type {
  PersistedMeta,
  SessionSnapshot,
  SessionStorage,
  SessionWrite,
} from "@/lib/session/schema";

/** In-memory SessionStorage that records every write. */
const memoryStorage = () => {
  const writes: SessionWrite[] = [];
  let snapshot: SessionSnapshot | null = null;
  let failNext = false;
  const storage: SessionStorage = {
    clear: () => {
      snapshot = null;
      return Promise.resolve();
    },
    readMeta: () => Promise.resolve(snapshot?.meta ?? null),
    readSnapshot: () => Promise.resolve(snapshot),
    write: (change) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(
          new DOMException("Quota exceeded", "QuotaExceededError")
        );
      }
      writes.push(change);
      const pages = new Map(
        change.reset ? [] : (snapshot?.pages ?? []).map((p) => [p.id, p])
      );
      for (const page of change.putPages) {
        pages.set(page.id, page);
      }
      for (const id of change.deletePageIds) {
        pages.delete(id);
      }
      const sources = new Map<string, Blob>(
        change.reset ? undefined : snapshot?.sources
      );
      for (const source of change.putSources) {
        sources.set(source.docId, source.bytes);
      }
      for (const docId of change.deleteSourceIds) {
        sources.delete(docId);
      }
      snapshot = {
        assets: change.putAssets,
        meta: change.meta,
        pages: [...pages.values()],
        sources,
      };
      return Promise.resolve();
    },
  };
  return {
    failNextWrite: () => {
      failNext = true;
    },
    snapshot: () => snapshot,
    storage,
    writes,
  };
};

const page = (id: string, sourceIndex: number): EditorPage => ({
  cropBox: { height: 792, width: 612, x: 0, y: 0 },
  height: 792,
  id,
  objects: [],
  pdfAnnotationObjects: [],
  pdfImageObjects: [],
  pdfTextObjects: [],
  pdfVectorObjects: [],
  rotation: 0,
  skippedPdfAnnotationSubtypes: [],
  sourceIndex,
  sourceRotate: 0,
  width: 612,
});

const text = (id: string): TextObject => ({
  align: "left",
  color: "#111827",
  content: "Saved",
  fontFamily: "sans",
  fontSize: 16,
  fontWeight: 400,
  height: 28,
  id,
  italic: false,
  opacity: 1,
  rotation: 0,
  source: "overlay",
  type: "text",
  width: 120,
  x: 40,
  y: 40,
});

let memory: ReturnType<typeof memoryStorage>;
let bytes: Uint8Array | null;
let autosave: Autosave | null;
let onDisabled: ReturnType<typeof vi.fn<AutosaveDeps["onDisabled"]>>;
let free: number | null;
/** Inserted PDFs' bytes, by docId. */
const otherSources = new Map<string, Uint8Array>();

const start = (): Autosave => {
  autosave = createAutosave({
    claimSlot: () => Promise.resolve(true),
    freeStorage: () => Promise.resolve(free),
    getAsset: editorStore.getAsset,
    getState: editorStore.getState,
    isDirty: editorStore.isDirty,
    ocrWords: () => ({}),
    onDisabled,
    releaseSlot: () => {},
    sourceBytes: () => bytes,
    sourceBytesOf: (docId) => otherSources.get(docId) ?? null,
    storage: memory.storage,
    subscribe: editorStore.subscribe,
  });
  return autosave;
};

const open = (): void => {
  bytes = new Uint8Array([37, 80, 68, 70, 45]);
  editorStore.resetDocument([page("page-1", 0), page("page-2", 1)], "a.pdf");
  editorStore.markHydrated();
};

/** Let timers fire and the write queue settle. */
const settle = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  memory = memoryStorage();
  bytes = null;
  autosave = null;
  free = null;
  onDisabled = vi.fn<AutosaveDeps["onDisabled"]>();
  otherSources.clear();
});

afterEach(() => {
  autosave?.stop();
  editorStore.clearDocument();
  vi.useRealTimers();
});

test("an edit is saved once editing pauses, with the source PDF", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS - 1);
  expect(memory.writes).toHaveLength(0);
  await settle(1);
  expect(memory.writes).toHaveLength(1);
  const [write] = memory.writes;
  expect(write?.reset).toBe(true);
  expect(
    write?.putSources.map((source) => [source.docId, source.bytes.size])
  ).toEqual([["primary", 5]]);
  expect(write?.putPages.map((item) => item.id)).toEqual(["page-1", "page-2"]);
  expect(write?.meta.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
  expect(write?.meta.pageOrder).toEqual(["page-1", "page-2"]);
});

test("later saves write only the pages that changed", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  editorStore.setCurrentPage("page-2");
  editorStore.addObject(text("t2"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  const [, second] = memory.writes;
  expect(second?.reset).toBe(false);
  expect(second?.putSources).toEqual([]);
  expect(second?.putPages.map((item) => item.id)).toEqual(["page-2"]);
});

test("continuous editing still saves after the maximum wait", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  for (let elapsed = 0; elapsed < AUTOSAVE_MAX_WAIT_MS; elapsed += 1000) {
    editorStore.patchSelected((object) => ({ ...object, x: object.x + 1 }));
    // oxlint-disable-next-line no-await-in-loop -- time passes between edits
    await settle(1000);
  }
  expect(memory.writes.length).toBeGreaterThan(0);
});

test("nothing is saved while the PDF is still loading or unedited", async () => {
  start();
  bytes = new Uint8Array([1]);
  editorStore.resetDocument([page("page-1", 0)], "a.pdf");
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_MAX_WAIT_MS);
  expect(memory.writes).toHaveLength(0);
  editorStore.undo();
  editorStore.markHydrated();
  await settle(AUTOSAVE_MAX_WAIT_MS);
  expect(memory.writes).toHaveLength(0);
});

test("undoing back to the opened document clears the save", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  expect(memory.snapshot()).not.toBeNull();
  editorStore.undo();
  await settle(0);
  expect(memory.snapshot()).toBeNull();
});

test("an export (markClean) clears the save", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  editorStore.markClean();
  await settle(0);
  expect(memory.snapshot()).toBeNull();
});

test("opening another file clears this tab's save", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  open();
  await settle(0);
  expect(memory.snapshot()).toBeNull();
});

test("an inserted PDF is saved once, and dropped when its pages go", async () => {
  start();
  open();
  otherSources.set("file:a", new Uint8Array([1, 2, 3]));
  const inserted: EditorPage = { ...page("page-3", 0), docId: "file:a" };
  const [first, second] = editorStore.getState().document.pages;
  if (!(first && second)) {
    throw new Error("expected two pages");
  }
  editorStore.setPages([first, second, inserted]);
  await settle(AUTOSAVE_DEBOUNCE_MS);
  const sources = (index: number) =>
    memory.writes[index]?.putSources.map((source) => source.docId);
  expect(sources(0)).toEqual(["primary", "file:a"]);
  expect(memory.writes[0]?.meta.sources.map((source) => source.kind)).toEqual([
    "file",
    "file",
  ]);

  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  expect(sources(1)).toEqual([]);

  editorStore.setPages([first, second]);
  await settle(AUTOSAVE_DEBOUNCE_MS);
  expect(memory.writes[2]?.deleteSourceIds).toEqual(["file:a"]);
  expect(memory.snapshot()?.sources.has("file:a")).toBe(false);
});

test("referenced images are saved; preview images are not", async () => {
  start();
  open();
  const asset = editorStore.addAsset(new Uint8Array([9, 9]), "image/png");
  const preview = editorStore.addAsset(new Uint8Array([7]), "image/png", {
    provisional: true,
  });
  const image: ImageObject = {
    assetId: asset.id,
    height: 10,
    id: "i1",
    mimeType: "image/png",
    opacity: 1,
    rotation: 0,
    source: "overlay",
    type: "image",
    width: 10,
    x: 0,
    y: 0,
  };
  editorStore.addObject(image);
  await settle(AUTOSAVE_DEBOUNCE_MS);
  const saved = memory.writes[0]?.putAssets.map((item) => item.id);
  expect(saved).toEqual([asset.id]);
  expect(saved).not.toContain(preview.id);
});

test("a failed write turns autosave off and says so once", async () => {
  start();
  open();
  memory.failNextWrite();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  editorStore.patchSelected((object) => ({ ...object, x: 99 }));
  await settle(AUTOSAVE_MAX_WAIT_MS);
  expect(onDisabled).toHaveBeenCalledTimes(1);
  expect(onDisabled).toHaveBeenCalledWith("quota");
  expect(memory.writes).toHaveLength(0);
});

test("too little free storage turns autosave off before writing", async () => {
  free = 1024;
  start();
  open();
  editorStore.addObject(text("t1"));
  await settle(AUTOSAVE_DEBOUNCE_MS);
  expect(memory.writes).toHaveLength(0);
  expect(onDisabled).toHaveBeenCalledWith("quota");
});

test("a flush saves pending edits at once", async () => {
  start();
  open();
  editorStore.addObject(text("t1"));
  await autosave?.flush();
  expect(memory.writes).toHaveLength(1);
});

const meta = (overrides: Partial<PersistedMeta> = {}): PersistedMeta => ({
  assetIds: [],
  currentPageId: null,
  fileName: "a.pdf",
  ocrWordsByPage: {},
  pageOrder: ["page-1"],
  savedAt: 0,
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: "s",
  sources: [],
  ...overrides,
});

test("saved metadata is checked and versioned before use", () => {
  expect(isPersistedMeta(meta())).toBe(true);
  expect(isPersistedMeta({ ...meta(), pageOrder: [1] })).toBe(false);
  expect(isPersistedMeta(null)).toBe(false);
  expect(migrateMeta(meta())).toEqual(meta());
  expect(
    migrateMeta(meta({ schemaVersion: SESSION_SCHEMA_VERSION + 1 }))
  ).toBeNull();
  expect(migrateMeta(meta({ schemaVersion: 0 }))).toBeNull();
});

/** A checkbox as version 2 stored it: checked or not. */
const version2Checkbox = (
  id: string,
  value: boolean,
  exportValue: string | null
) => ({
  id,
  kind: "checkbox",
  name: id,
  originalValue: !value,
  readOnly: false,
  required: false,
  value,
  widgets: [
    {
      exportValue,
      height: 16,
      id: `widget-${id}`,
      pageId: "page-1",
      sourceAnnotId: "12R",
      width: 16,
      x: 0,
      y: 0,
    },
  ],
});

test("version 2 checkbox booleans migrate to on-states", () => {
  const stored = {
    ...meta({ schemaVersion: 2 }),
    form: {
      fields: [
        version2Checkbox("on", true, "Agree"),
        version2Checkbox("off", false, "Agree"),
        version2Checkbox("unnamed", true, null),
      ],
      hasJavaScript: false,
      hasXfa: false,
      signatures: [],
    },
  };
  if (!isPersistedMeta(stored)) {
    throw new Error("The stored meta should pass the structural check.");
  }
  const fields = migrateMeta(stored)?.form?.fields ?? [];
  const values = fields.map((field) =>
    field.kind === "checkbox" ? [field.value, field.originalValue] : null
  );
  expect(values).toEqual([
    ["Agree", null],
    [null, "Agree"],
    ["Yes", null],
  ]);
});
