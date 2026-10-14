import { useSyncExternalStore } from "react";

import {
  clamp,
  fitPageScale,
  fitWidthScale,
  normalizeRotation,
} from "@/lib/editor/coordinates";
import {
  cloneSnapshot,
  emptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/lib/editor/history";
import type { HistoryState } from "@/lib/editor/history";
import { createId } from "@/lib/editor/ids";
import {
  findObject,
  findPage,
  findPdfAnnotation,
  findPdfFormField,
  findPdfImage,
  findPdfText,
  findPdfVector,
  fittedPdfTextBox,
  mapDocumentFormFields,
  mapPageObjects,
  mapPagePdfAnnotations,
  mapPagePdfImages,
  mapPagePdfVectors,
  measurePdfTextWidth,
  pdfLinkBoxAfterLabel,
  pdfLinkEditableLabel,
  removeObjects,
  updateObject,
} from "@/lib/editor/object-utils";
import {
  DEFAULT_DRAW_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
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
import type { SampledCaptionInk } from "@/lib/pdf/sample-caption-ink";

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
  isExporting: boolean;
  selectedObjectIds: readonly string[];
  selectedOcrWordIds: readonly string[];
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
  history: HistoryState;
  listeners: Set<() => void>;
  state: EditorStoreState;
}

const initialState = (): EditorStoreState => ({
  currentPageId: null,
  document: { form: EMPTY_PDF_FORM, pages: [] },
  drawStyle: { ...DEFAULT_DRAW_STYLE },
  errorMessage: null,
  fileName: null,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  isExporting: false,
  selectedObjectIds: [],
  selectedOcrWordIds: [],
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
  history: emptyHistory(),
  listeners: new Set(),
  state: initialState(),
};

const emit = (): void => {
  for (const listener of internal.listeners) {
    listener();
  }
};

const getSnapshot = (): HistorySnapshot => ({
  currentPageId: internal.state.currentPageId,
  document: internal.state.document,
  selectedObjectIds: internal.state.selectedObjectIds,
});

const applySnapshot = (snapshot: HistorySnapshot): void => {
  internal.state = {
    ...internal.state,
    currentPageId: snapshot.currentPageId,
    document: snapshot.document,
    selectedObjectIds: snapshot.selectedObjectIds,
  };
};

const commit = (mutate: () => void, recordHistory: boolean): void => {
  const before = recordHistory ? cloneSnapshot(getSnapshot()) : null;
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
  if (isSourceOrder(existing)) {
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
  const patchSnapshot = (snapshot: HistorySnapshot): HistorySnapshot => ({
    ...snapshot,
    document: patch(snapshot.document),
  });
  internal.history = {
    future: internal.history.future.map(patchSnapshot),
    past: internal.history.past.map(patchSnapshot),
  };
};

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

  addObject: (object: EditorObject, select = true): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
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
        tool: "select",
      };
    }, true);
  },

  appendPages: (pages: EditorPage[]): void => {
    if (pages.length === 0) {
      return;
    }
    const merged = mergeHydratedPages(internal.state.document.pages, pages);
    if (merged.length === internal.state.document.pages.length) {
      return;
    }
    internal.state = {
      ...internal.state,
      currentPageId: internal.state.currentPageId ?? merged[0]?.id ?? null,
      document: { ...internal.state.document, pages: merged },
    };
    patchHistoryDocuments((document) => ({
      ...document,
      pages: mergeHydratedPages(document.pages, structuredClone(pages)),
    }));
    emit();
  },

  canRedo: (): boolean => internal.history.future.length > 0,

  canUndo: (): boolean => internal.history.past.length > 0,

  clearDocument: (): void => {
    editorStore.revokeAssets();
    internal.history = emptyHistory();
    setState(initialState());
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
    sampledCaption: SampledCaptionInk | null = null
  ): void => {
    const pageId = internal.state.currentPageId;
    const objectId = internal.state.selectedPdfAnnotationId;
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
                    captionUnderline: sampledCaption?.underline,
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

  isProvisionalAsset: (assetId: string): boolean =>
    internal.assets.get(assetId)?.provisional === true,

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
    commit(() => {
      internal.state = {
        ...internal.state,
        document: withPages(
          internal.state.document.pages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  pdfTextObjects: page.pdfTextObjects.map((object) =>
                    object.id === objectId ? updater(object) : object
                  ),
                }
              : page
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
              ids.has(object.id) ? updater(object) : object
            )
          )
        ),
      };
    }, true);
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
    const result = redoHistory(internal.history, getSnapshot());
    if (!result) {
      return;
    }
    internal.history = result.history;
    applySnapshot(result.snapshot);
    emit();
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
    setState({
      currentPageId: pages[0]?.id ?? null,
      document: { form, pages },
      errorMessage: null,
      fileName,
      selectedObjectIds: [],
      selectedOcrWordIds: [],
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
    internal.state = {
      ...internal.state,
      document: { ...internal.state.document, form },
    };
    patchHistoryDocuments((document) =>
      isPlaceholderForm(document.form)
        ? { ...document, form: structuredClone(form) }
        : document
    );
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
        selectedPdfAnnotationId: null,
        selectedPdfFormFieldId: null,
        selectedPdfImageId: null,
        selectedPdfTextId: null,
        selectedPdfVectorId: null,
      };
    }, recordHistory);
  },

  setPdfImagePreview: (objectId: string, previewAssetId: string): void => {
    commit(() => {
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
    }, false);
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

  undo: (): void => {
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

export const useCanRedo = (): boolean =>
  useSyncExternalStore(
    editorStore.subscribe,
    editorStore.canRedo,
    editorStore.canRedo
  );
