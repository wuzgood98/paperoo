import { useSyncExternalStore } from "react";

import {
  clamp,
  fitPageScale,
  fitWidthScale,
  normalizeRotation,
} from "@/lib/editor/coordinates";
import {
  deepFreeze,
  emptyHistory,
  pushHistory,
  redoHistory,
  snapshotsEqual,
  undoHistory,
} from "@/lib/editor/history";
import type { HistoryState } from "@/lib/editor/history";
import { createId } from "@/lib/editor/ids";
import {
  documentForm,
  findObject,
  findPage,
  findPdfAnnotation,
  findPdfFormField,
  findPdfImage,
  findPdfText,
  findPdfVector,
  fittedPdfTextBox,
  isPdfVectorDirty,
  mapDocumentFormFields,
  mapPageObjects,
  pinObject,
  mapPagePdfAnnotations,
  mapPagePdfImages,
  mapPagePdfVectors,
  measurePdfTextWidth,
  pdfLinkBoxAfterLabel,
  pdfLinkEditableLabel,
  pdfLinkPrimaryCoverRects,
  removeObjects,
  updateObject,
} from "@/lib/editor/object-utils";
import {
  DEFAULT_DRAW_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_REDACTION_FILL,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_TEXT_STYLE,
  MAX_ZOOM,
  MIN_ZOOM,
  EMPTY_PDF_FORM,
} from "@/lib/editor/types";
import type {
  DrawStyleDefaults,
  EditorDocument,
  EditorObject,
  EditorPage,
  EditorStatus,
  EditorTool,
  HistorySnapshot,
  ImageAsset,
  ImageMimeType,
  PageRotation,
  PdfAnnotationObject,
  PdfFormField,
  PdfFormModel,
  PdfImageObject,
  PdfTextObject,
  PdfVectorObject,
  ShapeStyleDefaults,
  TextObject,
  TextStyleDefaults,
  ZoomMode,
} from "@/lib/editor/types";
import {
  appendEmbeddedFontGlyphs,
  mergeEmbeddedFontGlyphs,
} from "@/lib/pdf/embedded-font";
import type { SampledCaptionInk } from "@/lib/pdf/sample-caption-ink";
import type { PdfTextMeasurement } from "@/lib/pdf/sample-pdf-text-cover";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface EditorStoreState {
  currentPageId: string | null;
  document: EditorDocument;
  drawStyle: DrawStyleDefaults;
  errorMessage: string | null;
  fileName: string | null;
  highlightColor: string;
  /** Every page of the open PDF has loaded (hydration finished). */
  hydrated: boolean;
  isExporting: boolean;
  redactionFill: string;
  selectedObjectIds: readonly string[];
  selectedOcrWordIds: readonly string[];
  /** Pages picked in the page list for a bulk action; not part of undo. */
  selectedPageIds: readonly string[];
  selectedPdfFormFieldId: string | null;
  selectedPdfImageId: string | null;
  selectedPdfTextId: string | null;
  selectedPdfVectorId: string | null;
  selectedPdfAnnotationId: string | null;
  shapeStyle: ShapeStyleDefaults;
  showOcrRegions: boolean;
  status: EditorStatus;
  textStyle: TextStyleDefaults;
  tool: EditorTool;
  viewportSize: ViewportSize;
  zoom: number;
  zoomMode: ZoomMode;
}

interface StoreInternal {
  assets: Map<string, ImageAsset>;
  /**
   * The document as last opened or exported. Updates are immutable, so the
   * document is unsaved exactly when it is not this reference; undoing back
   * to it makes it saved again.
   */
  cleanDocument: EditorDocument | null;
  history: HistoryState;
  listeners: Set<() => void>;
  /** Snapshot from before the first uncommitted preview edit, if any. */
  previewBase: HistorySnapshot | null;
  /** True while a previewEdit callback runs, so its commits skip history. */
  previewing: boolean;
  state: EditorStoreState;
}

const initialState = (): EditorStoreState => ({
  currentPageId: null,
  document: { form: EMPTY_PDF_FORM, pages: [] },
  drawStyle: { ...DEFAULT_DRAW_STYLE },
  errorMessage: null,
  fileName: null,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  hydrated: false,
  isExporting: false,
  redactionFill: DEFAULT_REDACTION_FILL,
  selectedObjectIds: [],
  selectedOcrWordIds: [],
  selectedPageIds: [],
  selectedPdfAnnotationId: null,
  selectedPdfFormFieldId: null,
  selectedPdfImageId: null,
  selectedPdfTextId: null,
  selectedPdfVectorId: null,
  shapeStyle: { ...DEFAULT_SHAPE_STYLE },
  showOcrRegions: false,
  status: "idle",
  textStyle: { ...DEFAULT_TEXT_STYLE },
  tool: "select",
  viewportSize: { height: 800, width: 800 },
  zoom: 1,
  zoomMode: "fit-page",
});

const internal: StoreInternal = {
  assets: new Map(),
  cleanDocument: null,
  history: emptyHistory(),
  listeners: new Set(),
  previewBase: null,
  previewing: false,
  state: initialState(),
};

/** Dev/test guard: history shares documents by reference, so mutation must throw. */
const FREEZE_DOCUMENTS = process.env.NODE_ENV !== "production";

const emit = (): void => {
  if (FREEZE_DOCUMENTS) {
    deepFreeze(internal.state.document);
  }
  for (const listener of internal.listeners) {
    listener();
  }
};

const getSnapshot = (): HistorySnapshot => ({
  currentPageId: internal.state.currentPageId,
  document: internal.state.document,
  selectedObjectIds: internal.state.selectedObjectIds,
});

/** One form for the document: every source's fields, flags and signatures. */
const mergeForms = (into: PdfFormModel, added: PdfFormModel): PdfFormModel => ({
  fields: [...into.fields, ...added.fields],
  hasJavaScript: into.hasJavaScript || added.hasJavaScript,
  hasXfa: into.hasXfa || added.hasXfa,
  signatures: [...into.signatures, ...added.signatures],
});

/** Page selection limited to pages that still exist. */
const existingPageIds = (
  ids: readonly string[],
  pages: readonly EditorPage[]
): readonly string[] => {
  if (ids.length === 0) {
    return ids;
  }
  const present = new Set(pages.map((page) => page.id));
  const kept = ids.filter((id) => present.has(id));
  return kept.length === ids.length ? ids : kept;
};

const applySnapshot = (snapshot: HistorySnapshot): void => {
  internal.state = {
    ...internal.state,
    currentPageId: snapshot.currentPageId,
    document: snapshot.document,
    selectedObjectIds: snapshot.selectedObjectIds,
    selectedPageIds: existingPageIds(
      internal.state.selectedPageIds,
      snapshot.document.pages
    ),
  };
};

/** Where a Shift-click range starts: the last page toggled. */
let pageSelectionAnchor: string | null = null;

/** The latest frame-batched preview edit, not yet applied. */
let scheduledPreview: { edit: () => void; frame: number } | null = null;

const applyPreviewEdit = (edit: () => void): void => {
  internal.previewBase ??= getSnapshot();
  internal.previewing = true;
  try {
    edit();
  } finally {
    internal.previewing = false;
  }
};

/** Apply a scheduled preview edit now, so history sees its result. */
const runScheduledPreview = (): void => {
  const scheduled = scheduledPreview;
  if (!scheduled) {
    return;
  }
  scheduledPreview = null;
  cancelAnimationFrame(scheduled.frame);
  applyPreviewEdit(scheduled.edit);
};

/** Record pending preview edits as one undo step; returns true if one was pushed. */
const flushPreview = (): boolean => {
  runScheduledPreview();
  const base = internal.previewBase;
  if (!base) {
    return false;
  }
  internal.previewBase = null;
  if (snapshotsEqual(base, getSnapshot())) {
    return false;
  }
  internal.history = pushHistory(internal.history, base);
  return true;
};

const commit = (mutate: () => void, recordHistory: boolean): void => {
  const shouldRecord = recordHistory && !internal.previewing;
  if (shouldRecord) {
    flushPreview();
  }
  const before = shouldRecord ? getSnapshot() : null;
  mutate();
  if (before) {
    internal.history = pushHistory(internal.history, before);
  }
  emit();
};

const setState = (partial: Partial<EditorStoreState>): void => {
  internal.state = { ...internal.state, ...partial };
  emit();
};

const currentPage = (): EditorPage | undefined =>
  findPage(internal.state.document.pages, internal.state.currentPageId);

const withPages = (pages: EditorPage[]): EditorDocument => ({
  ...internal.state.document,
  pages,
});

const isSourceOrder = (pages: readonly EditorPage[]): boolean =>
  pages.every(
    (page, index) =>
      index === 0 || page.sourceIndex >= (pages[index - 1]?.sourceIndex ?? 0)
  );

/** Insert pages the user has not reordered; otherwise keep their order. */
const mergeHydratedPages = (
  existing: readonly EditorPage[],
  incoming: readonly EditorPage[]
): EditorPage[] => {
  const known = new Set(existing.map((page) => page.id));
  const fresh = incoming.filter((page) => !known.has(page.id));
  if (fresh.length === 0) {
    return [...existing];
  }
  const inSourceOrder = isSourceOrder(existing);
  const lastSourceIndex = existing.at(-1)?.sourceIndex ?? -1;
  // Hydration chunks normally arrive in order after everything loaded so far.
  if (
    inSourceOrder &&
    isSourceOrder(fresh) &&
    (fresh[0]?.sourceIndex ?? 0) >= lastSourceIndex
  ) {
    return [...existing, ...fresh];
  }
  if (inSourceOrder) {
    return [...existing, ...fresh].toSorted(
      (left, right) => left.sourceIndex - right.sourceIndex
    );
  }
  const merged = [...existing];
  const ordered = [...fresh].toSorted(
    (left, right) => left.sourceIndex - right.sourceIndex
  );
  for (const page of ordered) {
    const index = merged.findIndex(
      (entry) => entry.sourceIndex > page.sourceIndex
    );
    if (index === -1) {
      merged.push(page);
    } else {
      merged.splice(index, 0, page);
    }
  }
  return merged;
};

const isPlaceholderForm = (form: PdfFormModel | undefined): boolean =>
  !form ||
  (form.fields.length === 0 &&
    form.signatures.length === 0 &&
    !form.hasJavaScript &&
    !form.hasXfa);

const patchHistoryDocuments = (
  patch: (document: EditorDocument) => EditorDocument
): void => {
  // Snapshots share documents (selection-only steps keep the same one), so
  // patch each distinct document once.
  const patched = new Map<EditorDocument, EditorDocument>();
  const patchSnapshot = (snapshot: HistorySnapshot): HistorySnapshot => {
    let document = patched.get(snapshot.document);
    if (!document) {
      document = patch(snapshot.document);
      patched.set(snapshot.document, document);
    }
    return { ...snapshot, document };
  };
  internal.history = {
    future: internal.history.future.map(patchSnapshot),
    past: internal.history.past.map(patchSnapshot),
  };
  if (internal.previewBase) {
    internal.previewBase = patchSnapshot(internal.previewBase);
  }
  // Keep the saved document the same reference as its history snapshot.
  const clean = internal.cleanDocument;
  if (clean && clean !== internal.state.document) {
    internal.cleanDocument = patched.get(clean) ?? patch(clean);
  }
};

/**
 * Run an update that records a fact about the source PDF, not an edit: a
 * saved document stays saved.
 */
const applyFact = (update: () => void): void => {
  const wasClean = internal.cleanDocument === internal.state.document;
  update();
  if (wasClean) {
    internal.cleanDocument = internal.state.document;
  }
};

const mapPdfTextObject = (
  pages: readonly EditorPage[],
  pageId: string,
  objectId: string,
  updater: (object: PdfTextObject) => PdfTextObject
): EditorPage[] =>
  pages.map((page) =>
    page.id === pageId
      ? {
          ...page,
          pdfTextObjects: page.pdfTextObjects.map((object) =>
            object.id === objectId ? updater(object) : object
          ),
        }
      : page
  );

export const editorStore = {
  addAsset: (
    bytes: Uint8Array,
    mimeType: ImageMimeType,
    options: { provisional?: boolean } = {}
  ): ImageAsset => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: mimeType });
    const asset: ImageAsset = {
      bytes: copy,
      id: createId(),
      mimeType,
      objectUrl: URL.createObjectURL(blob),
    };
    if (options.provisional) {
      asset.provisional = true;
    }
    internal.assets.set(asset.id, asset);
    return asset;
  },

  /**
   * Adds an object to the current page. By default it selects the object and
   * returns to the Select tool; `keepTool` leaves both alone so a repeatable
   * tool (draw, highlight, shapes) stays ready for the next stroke.
   */
  addObject: (
    object: EditorObject,
    { keepTool = false }: { keepTool?: boolean } = {}
  ): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    const select = !keepTool;
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPageObjects(internal.state.document.pages, pageId, (objects) => [
            ...objects,
            object,
          ])
        ),
        selectedObjectIds: select
          ? [object.id]
          : internal.state.selectedObjectIds,
        selectedOcrWordIds: select ? [] : internal.state.selectedOcrWordIds,
        selectedPdfAnnotationId: select
          ? null
          : internal.state.selectedPdfAnnotationId,
        selectedPdfFormFieldId: select
          ? null
          : internal.state.selectedPdfFormFieldId,
        selectedPdfImageId: select ? null : internal.state.selectedPdfImageId,
        selectedPdfTextId: select ? null : internal.state.selectedPdfTextId,
        selectedPdfVectorId: select ? null : internal.state.selectedPdfVectorId,
        tool: keepTool ? internal.state.tool : "select",
      };
    }, true);
  },

  appendPages: (pages: EditorPage[]): void => {
    if (pages.length === 0) {
      return;
    }
    const existing = internal.state.document.pages;
    const known = new Set(existing.map((page) => page.id));
    const fresh = pages.filter((page) => !known.has(page.id));
    if (fresh.length === 0) {
      return;
    }
    const merged = appendEmbeddedFontGlyphs(
      existing,
      fresh,
      mergeHydratedPages
    );
    applyFact(() => {
      internal.state = {
        ...internal.state,
        currentPageId: internal.state.currentPageId ?? merged[0]?.id ?? null,
        document: { ...internal.state.document, pages: merged },
      };
      patchHistoryDocuments((document) => {
        const loadedIds = new Set(document.pages.map((page) => page.id));
        return {
          ...document,
          pages: appendEmbeddedFontGlyphs(
            document.pages,
            pages.filter((page) => !loadedIds.has(page.id)),
            mergeHydratedPages
          ),
        };
      });
    });
    emit();
  },

  /**
   * Store text recognized in an outline-only label. Recognition describes
   * the source PDF, not an edit: it skips undo and fills every history
   * snapshot where the label's path is still untouched. The path becomes
   * the runs' original ink and leaves vector selection.
   */
  applyOutlineTextRuns: (
    pageId: string,
    vectorId: string,
    runs: readonly PdfTextObject[]
  ): void => {
    const attach = (page: EditorPage): EditorPage => {
      const vector = page.pdfVectorObjects.find((item) => item.id === vectorId);
      if (
        !vector ||
        vector.textInk === true ||
        isPdfVectorDirty(vector) ||
        page.pdfTextObjects.some((run) => run.inkVectorId === vectorId)
      ) {
        return page;
      }
      return {
        ...page,
        pdfTextObjects: [...page.pdfTextObjects, ...runs],
        pdfVectorObjects: page.pdfVectorObjects.map((item) =>
          item.id === vectorId ? { ...item, textInk: true } : item
        ),
      };
    };
    const patch = (document: EditorDocument): EditorDocument => ({
      ...document,
      pages: document.pages.map((page) =>
        page.id === pageId ? attach(page) : page
      ),
    });
    const [first] = runs;
    const reselect =
      internal.state.selectedPdfVectorId === vectorId && first !== undefined;
    applyFact(() => {
      internal.state = {
        ...internal.state,
        document: patch(internal.state.document),
      };
      patchHistoryDocuments(patch);
    });
    if (reselect) {
      // A click on the label selected its path; it is text now.
      internal.state = {
        ...internal.state,
        selectedPdfTextId: first.id,
        selectedPdfVectorId: null,
      };
    }
    emit();
  },

  /**
   * Store facts measured from a run's original ink and font. They describe the
   * source PDF, not an edit, so they skip undo and fill every history snapshot.
   * Fields already set are kept.
   */
  applyPdfTextMeasurement: (
    pageId: string,
    objectId: string,
    measurement: PdfTextMeasurement
  ): void => {
    const fill = (object: PdfTextObject): PdfTextObject => ({
      ...object,
      coverColor: object.coverColor ?? measurement.coverColor,
      coverColorUncertain:
        object.coverColor === undefined
          ? measurement.coverColorUncertain
          : object.coverColorUncertain,
      coverRects: object.coverRects ?? measurement.coverRects,
      reusableFontGlyphs:
        object.reusableFontGlyphs ?? measurement.reusableFontGlyphs,
    });
    const patch = (document: EditorDocument): EditorDocument => ({
      ...document,
      pages: mapPdfTextObject(document.pages, pageId, objectId, fill),
    });
    applyFact(() => {
      internal.state = {
        ...internal.state,
        document: patch(internal.state.document),
      };
      patchHistoryDocuments(patch);
    });
    emit();
  },

  canRedo: (): boolean => internal.history.future.length > 0,

  canUndo: (): boolean => internal.history.past.length > 0,

  clearDocument: (): void => {
    editorStore.revokeAssets();
    internal.history = emptyHistory();
    internal.previewBase = null;
    internal.cleanDocument = null;
    setState(initialState());
  },

  clearPageSelection: (): void => {
    pageSelectionAnchor = null;
    if (internal.state.selectedPageIds.length > 0) {
      setState({ selectedPageIds: [] });
    }
  },

  clearSelection: (): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
    });
  },

  commitObject: (
    objectId: string,
    object: EditorObject,
    recordHistory: boolean
  ): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          updateObject(
            internal.state.document.pages,
            pageId,
            objectId,
            () => object
          )
        ),
      };
    }, recordHistory);
  },

  commitOcrEdit: (object: TextObject, ocrWordId: string): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          internal.state.document.pages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  objects: [...page.objects, object],
                  suppressedOcrWordIds: [
                    ...(page.suppressedOcrWordIds ?? []),
                    ocrWordId,
                  ],
                }
              : page
          )
        ),
        selectedObjectIds: [object.id],
        selectedOcrWordIds: [],
        selectedPdfAnnotationId: null,
        selectedPdfFormFieldId: null,
        selectedPdfImageId: null,
        selectedPdfTextId: null,
        selectedPdfVectorId: null,
        tool: "select",
      };
    }, true);
  },

  commitPdfAnnotation: (
    object: PdfAnnotationObject,
    recordHistory: boolean
  ): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPagePdfAnnotations(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((item) => (item.id === object.id ? object : item))
          )
        ),
      };
    }, recordHistory);
  },

  commitPdfImage: (object: PdfImageObject, recordHistory: boolean): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPagePdfImages(internal.state.document.pages, pageId, (objects) =>
            objects.map((item) => (item.id === object.id ? object : item))
          )
        ),
      };
    }, recordHistory);
  },

  commitPdfLinkLabel: (
    label: string,
    sampledCaption: SampledCaptionInk | null = null,
    /** Pin the link when committing after an await; defaults to the selection. */
    target: { linkId: string; pageId: string } | null = null
  ): void => {
    const pageId = target?.pageId ?? internal.state.currentPageId;
    const objectId = target?.linkId ?? internal.state.selectedPdfAnnotationId;
    if (!pageId || !objectId) {
      return;
    }
    const page = findPage(internal.state.document.pages, pageId);
    if (!page) {
      return;
    }
    const link = findPdfAnnotation(page, objectId);
    if (!link || link.type !== "pdf-link") {
      return;
    }
    const { runs } = pdfLinkEditableLabel(page, link);
    const [primary] = runs;
    if (!primary) {
      return;
    }
    const box = pdfLinkBoxAfterLabel(link, primary, label);
    const coverRects = pdfLinkPrimaryCoverRects(
      page,
      link,
      runs,
      primary,
      sampledCaption?.underline
    );
    const runIds = new Set(runs.map((run) => run.id));
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          internal.state.document.pages.map((item) => {
            if (item.id !== pageId) {
              return item;
            }
            return {
              ...item,
              pdfAnnotationObjects: item.pdfAnnotationObjects.map((object) =>
                object.id === objectId && object.type === "pdf-link"
                  ? { ...object, ...box, label }
                  : object
              ),
              pdfTextObjects: item.pdfTextObjects.map((object) => {
                if (object.id === primary.id) {
                  const measured = measurePdfTextWidth(object, label);
                  const fitted = fittedPdfTextBox(object, measured);
                  return {
                    ...object,
                    ...fitted,
                    captionFill: sampledCaption?.fill,
                    captionUnderline: sampledCaption?.underline ?? undefined,
                    coverRects,
                    text: label,
                  };
                }
                if (runIds.has(object.id)) {
                  return { ...object, text: "" };
                }
                return object;
              }),
            };
          })
        ),
      };
    }, true);
  },

  commitPdfVector: (object: PdfVectorObject, recordHistory: boolean): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPagePdfVectors(internal.state.document.pages, pageId, (objects) =>
            objects.map((item) => (item.id === object.id ? object : item))
          )
        ),
      };
    }, recordHistory);
  },

  /** Record the pending previewEdit changes as a single undo step. */
  commitPreview: (): void => {
    if (flushPreview()) {
      emit();
    }
  },

  /** Delete pages as one undo step; the last page always stays. */
  deletePages: (pageIds: readonly string[]): boolean => {
    const doomed = new Set(pageIds);
    const next = internal.state.document.pages.filter(
      (page) => !doomed.has(page.id)
    );
    if (
      next.length === 0 ||
      next.length === internal.state.document.pages.length
    ) {
      return false;
    }
    editorStore.setPages(next);
    return true;
  },

  deleteSelected: (): void => {
    const pageId = internal.state.currentPageId;
    const annotationId = internal.state.selectedPdfAnnotationId;
    if (pageId && annotationId) {
      commit(() => {
        internal.state = {
          ...internal.state,
          document: withPages(
            mapPagePdfAnnotations(
              internal.state.document.pages,
              pageId,
              (objects) =>
                objects.map((object) =>
                  object.id === annotationId
                    ? { ...object, deleted: true }
                    : object
                )
            )
          ),
          selectedPdfAnnotationId: null,
        };
      }, true);
      return;
    }
    const imageId = internal.state.selectedPdfImageId;
    if (pageId && imageId) {
      commit(() => {
        internal.state = {
          ...internal.state,
          document: withPages(
            mapPagePdfImages(internal.state.document.pages, pageId, (objects) =>
              objects.map((object) =>
                object.id === imageId ? { ...object, deleted: true } : object
              )
            )
          ),
          selectedPdfImageId: null,
        };
      }, true);
      return;
    }
    const vectorId = internal.state.selectedPdfVectorId;
    if (pageId && vectorId) {
      commit(() => {
        internal.state = {
          ...internal.state,
          document: withPages(
            mapPagePdfVectors(
              internal.state.document.pages,
              pageId,
              (objects) =>
                objects.map((object) =>
                  object.id === vectorId ? { ...object, deleted: true } : object
                )
            )
          ),
          selectedPdfVectorId: null,
        };
      }, true);
      return;
    }
    if (internal.state.selectedPdfFormFieldId) {
      return;
    }
    if (!pageId || internal.state.selectedObjectIds.length === 0) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          removeObjects(
            internal.state.document.pages,
            pageId,
            internal.state.selectedObjectIds
          )
        ),
        selectedObjectIds: [],
      };
    }, true);
  },

  /**
   * Remove a text object the user left empty. When adding it was the last undo
   * step, that step is dropped too, so an abandoned click leaves no history.
   */
  discardEmptyText: (objectId: string): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    flushPreview();
    const previous = internal.history.past.at(-1);
    const addedLast =
      previous !== undefined &&
      !findPage(previous.document.pages, pageId)?.objects.some(
        (object) => object.id === objectId
      );
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          removeObjects(internal.state.document.pages, pageId, [objectId])
        ),
        selectedObjectIds: internal.state.selectedObjectIds.filter(
          (id) => id !== objectId
        ),
      };
    }, !addedLast);
    if (addedLast) {
      // Discarding the box undoes adding it, saved state included.
      if (previous.document === internal.cleanDocument) {
        internal.cleanDocument = internal.state.document;
      }
      internal.history = {
        future: [],
        past: internal.history.past.slice(0, -1),
      };
      emit();
    }
  },

  fitPage: (): void => {
    setState({ zoomMode: "fit-page" });
    editorStore.recomputeFitZoom();
  },

  fitWidth: (): void => {
    setState({ zoomMode: "fit-width" });
    editorStore.recomputeFitZoom();
  },

  getAsset: (assetId: string): ImageAsset | undefined =>
    internal.assets.get(assetId),

  getAssets: (): ReadonlyMap<string, ImageAsset> => internal.assets,

  getState: (): EditorStoreState => internal.state,

  /**
   * Add objects on top of a page as one undo step (paste, duplicate) and
   * select them with the Select tool.
   */
  insertObjects: (pageId: string, objects: readonly EditorObject[]): void => {
    if (
      objects.length === 0 ||
      !findPage(internal.state.document.pages, pageId)
    ) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPageObjects(internal.state.document.pages, pageId, (existing) => [
            ...existing,
            ...objects,
          ])
        ),
        selectedObjectIds: objects.map((object) => object.id),
        selectedOcrWordIds: [],
        selectedPdfAnnotationId: null,
        selectedPdfFormFieldId: null,
        selectedPdfImageId: null,
        selectedPdfTextId: null,
        selectedPdfVectorId: null,
        tool: "select",
      };
    }, true);
  },

  /**
   * Insert pages at `atIndex` as one undo step and make the first current.
   * Waits for every page to load: hydration places pages by source order.
   */
  insertPages: (
    atIndex: number,
    pages: readonly EditorPage[],
    /** The form of the PDF the pages come from, merged into the document's. */
    form?: PdfFormModel
  ): boolean => {
    const { document, hydrated, status } = internal.state;
    if (status !== "ready" || !hydrated || pages.length === 0) {
      return false;
    }
    const index = clamp(Math.round(atIndex), 0, document.pages.length);
    commit(() => {
      internal.state = {
        ...internal.state,
        currentPageId: pages[0]?.id ?? internal.state.currentPageId,
        document: {
          form: form ? mergeForms(documentForm(document), form) : document.form,
          pages: [
            ...document.pages.slice(0, index),
            ...pages,
            ...document.pages.slice(index),
          ],
        },
        selectedObjectIds: [],
        selectedOcrWordIds: [],
        selectedPdfAnnotationId: null,
        selectedPdfFormFieldId: null,
        selectedPdfImageId: null,
        selectedPdfTextId: null,
        selectedPdfVectorId: null,
      };
    }, true);
    return true;
  },

  /** True when an open document has edits since it was opened or exported. */
  isDirty: (): boolean =>
    internal.state.status === "ready" &&
    internal.state.document !== internal.cleanDocument,

  isProvisionalAsset: (assetId: string): boolean =>
    internal.assets.get(assetId)?.provisional === true,

  /**
   * Record `document` as saved, e.g. the one a full export wrote. Edits made
   * while it exported keep the current document unsaved.
   */
  markClean: (document: EditorDocument = internal.state.document): void => {
    if (internal.cleanDocument === document) {
      return;
    }
    internal.cleanDocument = document;
    emit();
  },

  markHydrated: (): void => {
    if (!internal.state.hydrated) {
      setState({ hydrated: true });
    }
  },

  patchPdfAnnotation: (
    updater: (object: PdfAnnotationObject) => PdfAnnotationObject
  ): void => {
    const pageId = internal.state.currentPageId;
    const objectId = internal.state.selectedPdfAnnotationId;
    if (!pageId || !objectId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPagePdfAnnotations(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((object) =>
                object.id === objectId ? updater(object) : object
              )
          )
        ),
      };
    }, true);
  },

  patchPdfFormField: (updater: (field: PdfFormField) => PdfFormField): void => {
    const fieldId = internal.state.selectedPdfFormFieldId;
    if (!fieldId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: mapDocumentFormFields(internal.state.document, (field) =>
          field.id === fieldId ? updater(field) : field
        ),
      };
    }, true);
  },

  patchPdfImage: (
    updater: (object: PdfImageObject) => PdfImageObject
  ): void => {
    const pageId = internal.state.currentPageId;
    const objectId = internal.state.selectedPdfImageId;
    if (!pageId || !objectId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPagePdfImages(internal.state.document.pages, pageId, (objects) =>
            objects.map((object) =>
              object.id === objectId ? updater(object) : object
            )
          )
        ),
      };
    }, true);
  },

  patchPdfText: (updater: (object: PdfTextObject) => PdfTextObject): void => {
    const pageId = internal.state.currentPageId;
    const objectId = internal.state.selectedPdfTextId;
    if (!pageId || !objectId) {
      return;
    }
    editorStore.patchPdfTextById(pageId, objectId, updater);
  },

  /** Patch one run by id; async callers must not rely on the live selection. */
  patchPdfTextById: (
    pageId: string,
    objectId: string,
    updater: (object: PdfTextObject) => PdfTextObject
  ): void => {
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPdfTextObject(
            internal.state.document.pages,
            pageId,
            objectId,
            updater
          )
        ),
      };
    }, true);
  },

  patchPdfVector: (
    updater: (object: PdfVectorObject) => PdfVectorObject
  ): void => {
    const pageId = internal.state.currentPageId;
    const objectId = internal.state.selectedPdfVectorId;
    if (!pageId || !objectId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPagePdfVectors(internal.state.document.pages, pageId, (objects) =>
            objects.map((object) =>
              object.id === objectId ? updater(object) : object
            )
          )
        ),
      };
    }, true);
  },

  patchSelected: (updater: (object: EditorObject) => EditorObject): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId || internal.state.selectedObjectIds.length === 0) {
      return;
    }
    const ids = new Set(internal.state.selectedObjectIds);
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPageObjects(internal.state.document.pages, pageId, (objects) =>
            objects.map((object) =>
              ids.has(object.id) ? pinObject(updater(object)) : object
            )
          )
        ),
      };
    }, true);
  },

  /**
   * Apply a live edit (e.g. a slider mid-drag) without recording history.
   * Successive previews collapse into one undo step, recorded by
   * commitPreview(), the next recorded edit, or undo/redo.
   */
  previewEdit: (edit: () => void): void => {
    applyPreviewEdit(edit);
  },

  recomputeFitZoom: (): void => {
    const page = currentPage();
    if (!page) {
      return;
    }
    const { viewportSize, zoomMode } = internal.state;
    if (zoomMode === "fit-width") {
      editorStore.setZoom(fitWidthScale(page, viewportSize), "fit-width");
      return;
    }
    if (zoomMode === "fit-page") {
      editorStore.setZoom(fitPageScale(page, viewportSize), "fit-page");
    }
  },

  redo: (): void => {
    flushPreview();
    const result = redoHistory(internal.history, getSnapshot());
    if (!result) {
      return;
    }
    internal.history = result.history;
    applySnapshot(result.snapshot);
    emit();
  },

  /**
   * Make the first selected object's style the default for the next object of
   * its kind, so a color or width picked once carries forward.
   */
  rememberSelectedStyle: (): void => {
    const [id] = internal.state.selectedObjectIds;
    const object = currentPage()?.objects.find((item) => item.id === id);
    if (object?.type === "text") {
      const { align, color, fontFamily, fontSize, fontWeight, italic } = object;
      editorStore.setTextStyle({
        align,
        color,
        fontFamily,
        fontSize,
        fontWeight,
        italic,
      });
    } else if (object?.type === "drawing") {
      editorStore.setDrawStyle({
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
      });
    } else if (object?.type === "shape") {
      const style: Partial<ShapeStyleDefaults> = {
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
      };
      // A line has no fill; keep the last box fill for the next box.
      if (object.shape !== "line") {
        style.fill = object.fill;
      }
      editorStore.setShapeStyle(style);
    } else if (object?.type === "highlight") {
      editorStore.setHighlightColor(object.color);
    } else if (object?.type === "redaction") {
      editorStore.setRedactionFill(object.fill);
    }
  },

  reorderSelected: (placement: "front" | "back"): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId || internal.state.selectedObjectIds.length === 0) {
      return;
    }
    const ids = new Set(internal.state.selectedObjectIds);
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          mapPageObjects(internal.state.document.pages, pageId, (objects) => {
            const selected = objects.filter((object) => ids.has(object.id));
            const rest = objects.filter((object) => !ids.has(object.id));
            return placement === "front"
              ? [...rest, ...selected]
              : [...selected, ...rest];
          })
        ),
      };
    }, true);
  },

  replaceObject: (objectId: string, object: EditorObject): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          updateObject(
            internal.state.document.pages,
            pageId,
            objectId,
            () => object
          )
        ),
      };
    }, false);
  },

  resetDocument: (
    pages: EditorPage[],
    fileName: string,
    form: PdfFormModel = EMPTY_PDF_FORM
  ): void => {
    editorStore.revokeAssets();
    internal.history = emptyHistory();
    internal.previewBase = null;
    const document: EditorDocument = {
      form,
      pages: mergeEmbeddedFontGlyphs(pages),
    };
    internal.cleanDocument = document;
    setState({
      currentPageId: pages[0]?.id ?? null,
      document,
      errorMessage: null,
      fileName,
      hydrated: false,
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPageIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      showOcrRegions: false,
      status: "ready",
      tool: "select",
      zoomMode: "fit-page",
    });
    editorStore.recomputeFitZoom();
  },

  /** Re-add a saved image under its saved id, so restored objects find it. */
  restoreAsset: (
    id: string,
    bytes: Uint8Array,
    mimeType: ImageMimeType
  ): ImageAsset => {
    // Own a plain ArrayBuffer copy, as addAsset does.
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy], { type: mimeType });
    const asset: ImageAsset = {
      bytes: copy,
      id,
      mimeType,
      objectUrl: URL.createObjectURL(blob),
    };
    internal.assets.set(id, asset);
    return asset;
  },

  /**
   * Open a restored session: its pages are fully loaded, and its edits are
   * unsaved because nothing was exported since. Restore assets first.
   */
  restoreDocument: (
    document: EditorDocument,
    fileName: string,
    currentPageId: string | null
  ): void => {
    internal.history = emptyHistory();
    internal.previewBase = null;
    internal.cleanDocument = null;
    const restored: EditorDocument = {
      ...document,
      pages: mergeEmbeddedFontGlyphs(document.pages),
    };
    const hasCurrent = restored.pages.some((page) => page.id === currentPageId);
    setState({
      currentPageId: hasCurrent
        ? currentPageId
        : (restored.pages[0]?.id ?? null),
      document: restored,
      errorMessage: null,
      fileName,
      hydrated: true,
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPageIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      showOcrRegions: false,
      status: "ready",
      tool: "select",
      zoomMode: "fit-page",
    });
    editorStore.recomputeFitZoom();
  },

  revokeAssets: (): void => {
    for (const asset of internal.assets.values()) {
      URL.revokeObjectURL(asset.objectUrl);
    }
    internal.assets.clear();
  },

  rotateCurrentPage: (delta: PageRotation): void => {
    const page = currentPage();
    if (!page) {
      return;
    }
    const nextRotation = normalizeRotation(page.rotation + delta);
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          internal.state.document.pages.map((item) =>
            item.id === page.id ? { ...item, rotation: nextRotation } : item
          )
        ),
      };
    }, true);
  },

  /** Rotate several pages by `delta` as one undo step. */
  rotatePages: (pageIds: readonly string[], delta: PageRotation): void => {
    const turning = new Set(pageIds);
    if (!internal.state.document.pages.some((page) => turning.has(page.id))) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          internal.state.document.pages.map((page) =>
            turning.has(page.id)
              ? { ...page, rotation: normalizeRotation(page.rotation + delta) }
              : page
          )
        ),
      };
    }, true);
  },

  /**
   * previewEdit at most once per frame, keeping only the latest edit. Sliders
   * and pickers report far more often than the page can repaint, and each
   * preview re-renders every view of the document.
   */
  schedulePreviewEdit: (edit: () => void): void => {
    if (scheduledPreview) {
      scheduledPreview.edit = edit;
      return;
    }
    scheduledPreview = {
      edit,
      frame: requestAnimationFrame(runScheduledPreview),
    };
  },

  selectObjects: (objectIds: readonly string[]): void => {
    setState({
      selectedObjectIds: objectIds,
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectOcrWords: (wordIds: readonly string[]): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: wordIds,
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  /** Shift-click: select every page from the last toggled one to `pageId`. */
  selectPageRange: (pageId: string): void => {
    const { pages } = internal.state.document;
    const anchorId = pageSelectionAnchor ?? internal.state.currentPageId;
    const from = pages.findIndex((page) => page.id === anchorId);
    const to = pages.findIndex((page) => page.id === pageId);
    if (to === -1) {
      return;
    }
    const [start, end] =
      from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
    setState({
      selectedPageIds: pages.slice(start, end + 1).map((page) => page.id),
    });
  },

  selectPdfAnnotation: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: objectId,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfFormField: (fieldId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: fieldId,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfImage: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: objectId,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfText: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: objectId,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfVector: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: objectId,
      tool: "select",
    });
  },

  selectedObject: (): EditorObject | undefined => {
    const page = currentPage();
    const [id] = internal.state.selectedObjectIds;
    if (!page || !id) {
      return undefined;
    }
    return findObject(page, id);
  },

  selectedPdfAnnotation: (): PdfAnnotationObject | undefined =>
    findPdfAnnotation(currentPage(), internal.state.selectedPdfAnnotationId),

  selectedPdfFormField: (): PdfFormField | undefined =>
    findPdfFormField(
      internal.state.document,
      internal.state.selectedPdfFormFieldId
    ),

  selectedPdfImage: (): PdfImageObject | undefined =>
    findPdfImage(currentPage(), internal.state.selectedPdfImageId),

  selectedPdfText: (): PdfTextObject | undefined =>
    findPdfText(currentPage(), internal.state.selectedPdfTextId),

  selectedPdfVector: (): PdfVectorObject | undefined =>
    findPdfVector(currentPage(), internal.state.selectedPdfVectorId),

  setCurrentPage: (
    pageId: string,
    options?: { syncFitZoom?: boolean }
  ): void => {
    const syncFitZoom = options?.syncFitZoom ?? true;
    if (pageId === internal.state.currentPageId) {
      if (syncFitZoom && internal.state.zoomMode !== "custom") {
        editorStore.recomputeFitZoom();
      }
      return;
    }
    setState({
      currentPageId: pageId,
      selectedObjectIds: [],
      selectedOcrWordIds: [],
      selectedPdfAnnotationId: null,
      selectedPdfFormFieldId: null,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
    });
    if (syncFitZoom && internal.state.zoomMode !== "custom") {
      editorStore.recomputeFitZoom();
    }
  },

  setDocumentForm: (form: PdfFormModel): void => {
    applyFact(() => {
      internal.state = {
        ...internal.state,
        document: { ...internal.state.document, form },
      };
      patchHistoryDocuments((document) =>
        isPlaceholderForm(document.form) ? { ...document, form } : document
      );
    });
    emit();
  },

  setDrawStyle: (drawStyle: Partial<DrawStyleDefaults>): void => {
    setState({ drawStyle: { ...internal.state.drawStyle, ...drawStyle } });
  },

  setExporting: (isExporting: boolean): void => {
    setState({ isExporting });
  },

  setFileName: (fileName: string | null): void => {
    setState({ fileName });
  },

  setHighlightColor: (highlightColor: string): void => {
    setState({ highlightColor });
  },

  setPages: (pages: EditorPage[], recordHistory = true): void => {
    commit(() => {
      const currentExists = pages.some(
        (page) => page.id === internal.state.currentPageId
      );
      internal.state = {
        ...internal.state,
        currentPageId: currentExists
          ? internal.state.currentPageId
          : (pages[0]?.id ?? null),
        document: withPages(pages),
        selectedObjectIds: [],
        selectedOcrWordIds: [],
        selectedPageIds: existingPageIds(internal.state.selectedPageIds, pages),
        selectedPdfAnnotationId: null,
        selectedPdfFormFieldId: null,
        selectedPdfImageId: null,
        selectedPdfTextId: null,
        selectedPdfVectorId: null,
      };
    }, recordHistory);
  },

  setPdfImagePreview: (objectId: string, previewAssetId: string): void => {
    applyFact(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          internal.state.document.pages.map((page) => {
            const target = page.pdfImageObjects.find(
              (item) => item.id === objectId
            );
            if (!target) {
              return page;
            }
            return {
              ...page,
              pdfImageObjects: page.pdfImageObjects.map((object) => {
                if (
                  object.id !== objectId &&
                  object.sourceId !== target.sourceId
                ) {
                  return object;
                }
                const current = object.previewAssetId;
                if (current && current !== previewAssetId) {
                  const existing = internal.assets.get(current);
                  if (!existing?.provisional) {
                    return object;
                  }
                  URL.revokeObjectURL(existing.objectUrl);
                  internal.assets.delete(current);
                }
                return { ...object, previewAssetId };
              }),
            };
          })
        ),
      };
    });
    emit();
  },

  setRedactionFill: (redactionFill: string): void => {
    setState({ redactionFill });
  },

  setShapeStyle: (shapeStyle: Partial<ShapeStyleDefaults>): void => {
    setState({ shapeStyle: { ...internal.state.shapeStyle, ...shapeStyle } });
  },

  setShowOcrRegions: (showOcrRegions: boolean): void => {
    setState({ showOcrRegions });
  },

  setStatus: (
    status: EditorStatus,
    errorMessage: string | null = null
  ): void => {
    setState({ errorMessage, status });
  },

  setTextStyle: (textStyle: Partial<TextStyleDefaults>): void => {
    setState({ textStyle: { ...internal.state.textStyle, ...textStyle } });
  },

  setTool: (tool: EditorTool): void => {
    setState({
      selectedObjectIds:
        tool === "select" ? internal.state.selectedObjectIds : [],
      selectedOcrWordIds:
        tool === "select" ? internal.state.selectedOcrWordIds : [],
      selectedPdfAnnotationId:
        tool === "select" ? internal.state.selectedPdfAnnotationId : null,
      selectedPdfFormFieldId:
        tool === "select" ? internal.state.selectedPdfFormFieldId : null,
      selectedPdfImageId:
        tool === "select" ? internal.state.selectedPdfImageId : null,
      selectedPdfTextId:
        tool === "select" ? internal.state.selectedPdfTextId : null,
      selectedPdfVectorId:
        tool === "select" ? internal.state.selectedPdfVectorId : null,
      tool,
    });
  },

  setViewportSize: (viewportSize: ViewportSize): void => {
    if (
      viewportSize.width === internal.state.viewportSize.width &&
      viewportSize.height === internal.state.viewportSize.height
    ) {
      return;
    }
    setState({ viewportSize });
    if (internal.state.zoomMode !== "custom") {
      editorStore.recomputeFitZoom();
    }
  },

  setZoom: (zoom: number, mode: ZoomMode = "custom"): void => {
    setState({
      zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
      zoomMode: mode,
    });
  },

  stepCurrentPage: (delta: 1 | -1): void => {
    const { pages } = internal.state.document;
    const index = pages.findIndex(
      (page) => page.id === internal.state.currentPageId
    );
    const next = pages[index + delta];
    if (!next) {
      return;
    }
    editorStore.setCurrentPage(next.id, { syncFitZoom: false });
  },

  subscribe: (listener: () => void): (() => void) => {
    internal.listeners.add(listener);
    return () => {
      internal.listeners.delete(listener);
    };
  },

  /** Ctrl/⌘-click: add `pageId` to the page selection or take it out. */
  togglePageSelection: (pageId: string): void => {
    const selected = internal.state.selectedPageIds;
    pageSelectionAnchor = pageId;
    setState({
      selectedPageIds: selected.includes(pageId)
        ? selected.filter((id) => id !== pageId)
        : [...selected, pageId],
    });
  },

  undo: (): void => {
    flushPreview();
    const result = undoHistory(internal.history, getSnapshot());
    if (!result) {
      return;
    }
    internal.history = result.history;
    applySnapshot(result.snapshot);
    emit();
  },

  zoomBy: (delta: number): void => {
    editorStore.setZoom(internal.state.zoom + delta, "custom");
  },
};

export const useEditorStore = <T>(
  selector: (state: EditorStoreState) => T
): T =>
  useSyncExternalStore(
    editorStore.subscribe,
    () => selector(internal.state),
    () => selector(internal.state)
  );

export const useCanUndo = (): boolean =>
  useSyncExternalStore(
    editorStore.subscribe,
    editorStore.canUndo,
    editorStore.canUndo
  );

export const useIsDirty = (): boolean =>
  useSyncExternalStore(
    editorStore.subscribe,
    editorStore.isDirty,
    editorStore.isDirty
  );

export const useCanRedo = (): boolean =>
  useSyncExternalStore(
    editorStore.subscribe,
    editorStore.canRedo,
    editorStore.canRedo
  );
