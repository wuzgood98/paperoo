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
  findPdfImage,
  findPdfText,
  findPdfVector,
  mapPageObjects,
  mapPagePdfImages,
  mapPagePdfVectors,
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
  PdfImageObject,
  PdfTextObject,
  PdfVectorObject,
  ShapeStyleDefaults,
  TextStyleDefaults,
  ZoomMode,
} from "@/lib/editor/types";

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
  selectedPdfImageId: string | null;
  selectedPdfTextId: string | null;
  selectedPdfVectorId: string | null;
  shapeStyle: ShapeStyleDefaults;
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
  document: { pages: [] },
  drawStyle: { ...DEFAULT_DRAW_STYLE },
  errorMessage: null,
  fileName: null,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  isExporting: false,
  selectedObjectIds: [],
  selectedPdfImageId: null,
  selectedPdfTextId: null,
  selectedPdfVectorId: null,
  shapeStyle: { ...DEFAULT_SHAPE_STYLE },
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
        document: {
          pages: mapPageObjects(
            internal.state.document.pages,
            pageId,
            (objects) => [...objects, object]
          ),
        },
        selectedObjectIds: select
          ? [object.id]
          : internal.state.selectedObjectIds,
        selectedPdfImageId: select ? null : internal.state.selectedPdfImageId,
        selectedPdfTextId: select ? null : internal.state.selectedPdfTextId,
        selectedPdfVectorId: select ? null : internal.state.selectedPdfVectorId,
        tool: "select",
      };
    }, true);
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
        document: {
          pages: updateObject(
            internal.state.document.pages,
            pageId,
            objectId,
            () => object
          ),
        },
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
        document: {
          pages: mapPagePdfImages(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((item) => (item.id === object.id ? object : item))
          ),
        },
      };
    }, recordHistory);
  },

  commitPdfVector: (object: PdfVectorObject, recordHistory: boolean): void => {
    const pageId = internal.state.currentPageId;
    if (!pageId) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: {
          pages: mapPagePdfVectors(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((item) => (item.id === object.id ? object : item))
          ),
        },
      };
    }, recordHistory);
  },

  deleteSelected: (): void => {
    const pageId = internal.state.currentPageId;
    const imageId = internal.state.selectedPdfImageId;
    if (pageId && imageId) {
      commit(() => {
        internal.state = {
          ...internal.state,
          document: {
            pages: mapPagePdfImages(
              internal.state.document.pages,
              pageId,
              (objects) =>
                objects.map((object) =>
                  object.id === imageId ? { ...object, deleted: true } : object
                )
            ),
          },
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
          document: {
            pages: mapPagePdfVectors(
              internal.state.document.pages,
              pageId,
              (objects) =>
                objects.map((object) =>
                  object.id === vectorId ? { ...object, deleted: true } : object
                )
            ),
          },
          selectedPdfVectorId: null,
        };
      }, true);
      return;
    }
    if (!pageId || internal.state.selectedObjectIds.length === 0) {
      return;
    }
    commit(() => {
      internal.state = {
        ...internal.state,
        document: {
          pages: removeObjects(
            internal.state.document.pages,
            pageId,
            internal.state.selectedObjectIds
          ),
        },
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
        document: {
          pages: mapPagePdfImages(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((object) =>
                object.id === objectId ? updater(object) : object
              )
          ),
        },
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
        document: {
          pages: internal.state.document.pages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  pdfTextObjects: page.pdfTextObjects.map((object) =>
                    object.id === objectId ? updater(object) : object
                  ),
                }
              : page
          ),
        },
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
        document: {
          pages: mapPagePdfVectors(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((object) =>
                object.id === objectId ? updater(object) : object
              )
          ),
        },
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
        document: {
          pages: mapPageObjects(
            internal.state.document.pages,
            pageId,
            (objects) =>
              objects.map((object) =>
                ids.has(object.id) ? updater(object) : object
              )
          ),
        },
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
        document: {
          pages: mapPageObjects(
            internal.state.document.pages,
            pageId,
            (objects) => {
              const selected = objects.filter((object) => ids.has(object.id));
              const rest = objects.filter((object) => !ids.has(object.id));
              return placement === "front"
                ? [...rest, ...selected]
                : [...selected, ...rest];
            }
          ),
        },
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
        document: {
          pages: updateObject(
            internal.state.document.pages,
            pageId,
            objectId,
            () => object
          ),
        },
      };
    }, false);
  },

  resetDocument: (pages: EditorPage[], fileName: string): void => {
    editorStore.revokeAssets();
    internal.history = emptyHistory();
    setState({
      currentPageId: pages[0]?.id ?? null,
      document: { pages },
      errorMessage: null,
      fileName,
      selectedObjectIds: [],
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
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
        document: {
          pages: internal.state.document.pages.map((item) =>
            item.id === page.id ? { ...item, rotation: nextRotation } : item
          ),
        },
      };
    }, true);
  },

  selectObjects: (objectIds: readonly string[]): void => {
    setState({
      selectedObjectIds: objectIds,
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfImage: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedPdfImageId: objectId,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfText: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
      selectedPdfImageId: null,
      selectedPdfTextId: objectId,
      selectedPdfVectorId: null,
      tool: "select",
    });
  },

  selectPdfVector: (objectId: string | null): void => {
    setState({
      selectedObjectIds: [],
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
      selectedPdfImageId: null,
      selectedPdfTextId: null,
      selectedPdfVectorId: null,
    });
    if (syncFitZoom && internal.state.zoomMode !== "custom") {
      editorStore.recomputeFitZoom();
    }
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
        document: { pages },
        selectedObjectIds: [],
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
        document: {
          pages: internal.state.document.pages.map((page) => {
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
          }),
        },
      };
    }, false);
  },

  setShapeStyle: (shapeStyle: Partial<ShapeStyleDefaults>): void => {
    setState({ shapeStyle: { ...internal.state.shapeStyle, ...shapeStyle } });
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
