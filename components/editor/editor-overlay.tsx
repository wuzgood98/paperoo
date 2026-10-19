"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { OcrWordLayer } from "@/components/editor/ocr-word-layer";
import {
  useOverlayGestures,
  snapshotBounds,
} from "@/components/editor/overlay-gestures";
import type {
  Gesture,
  OverlayDraft,
} from "@/components/editor/overlay-gestures";
import { OverlayObject } from "@/components/editor/overlay-object";
import {
  beginOcrEditAtPoint,
  beginPdfTextEditAtPoint,
  EMPTY_PDF_HOVER,
  pdfHoverIdsAtPoint,
  samePdfHover,
  selectPdfObjectAtPoint,
} from "@/components/editor/overlay-pdf-hit";
import type { PdfHoverIds } from "@/components/editor/overlay-pdf-hit";
import { OverlayPreviews } from "@/components/editor/overlay-previews";
import { PdfAnnotationLayer } from "@/components/editor/pdf-annotation-layer";
import { PdfFormLayer } from "@/components/editor/pdf-form-layer";
import { PdfImageLayer } from "@/components/editor/pdf-image-layer";
import { PdfTextLayer } from "@/components/editor/pdf-text-layer";
import { PdfVectorLayer } from "@/components/editor/pdf-vector-layer";
import type { PageBounds } from "@/lib/editor/coordinates";
import {
  createSignatureObject,
  createTextObject,
  scaleSignaturePoints,
  SIGNATURE_PLACE_SIZE,
} from "@/lib/editor/object-utils";
import { pageDocId, pageKeyOf } from "@/lib/editor/page-source";
import { pendingSignature } from "@/lib/editor/pending";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorPage, Point } from "@/lib/editor/types";
import {
  hitTestOcrWord,
  ocrWordRangeIds,
  visibleOcrWords,
} from "@/lib/ocr/hit";
import { useOcrSelector } from "@/lib/ocr/session";
import type { OcrTextObject } from "@/lib/ocr/types";
import { ensurePdfImagePreview } from "@/lib/pdf/pdf-image-preview";
import { cn } from "@/lib/utils";

const NO_OCR_WORDS: readonly OcrTextObject[] = [];

/** Id of the topmost overlay text box under a client point, if any. */
const overlayTextIdAt = (
  root: HTMLElement,
  clientX: number,
  clientY: number,
  objects: EditorPage["objects"]
): string | null => {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const node = element.closest<HTMLElement>("[data-editor-object-id]");
    if (!(node && root.contains(node))) {
      continue;
    }
    const id = node.dataset.editorObjectId;
    return objects.some((object) => object.id === id && object.type === "text")
      ? (id ?? null)
      : null;
  }
  return null;
};

// oxlint-disable-next-line react-doctor/no-giant-component -- single overlay coordinates PDF layers, gestures, and tools.
export const EditorOverlay = ({
  page,
  zoom,
}: {
  page: EditorPage;
  zoom: number;
}) => {
  const tool = useEditorStore((state) => state.tool);
  const selectedObjectIds = useEditorStore((state) => state.selectedObjectIds);
  const selectedPdfImageId = useEditorStore(
    (state) => state.selectedPdfImageId
  );
  const selectedPdfTextId = useEditorStore((state) => state.selectedPdfTextId);
  const selectedPdfVectorId = useEditorStore(
    (state) => state.selectedPdfVectorId
  );
  const selectedPdfAnnotationId = useEditorStore(
    (state) => state.selectedPdfAnnotationId
  );
  const selectedPdfFormFieldId = useEditorStore(
    (state) => state.selectedPdfFormFieldId
  );
  const selectedOcrWordIds = useEditorStore(
    (state) => state.selectedOcrWordIds
  );
  const showOcrRegions = useEditorStore((state) => state.showOcrRegions);
  const drawStyle = useEditorStore((state) => state.drawStyle);
  const highlightColor = useEditorStore((state) => state.highlightColor);
  const redactionFill = useEditorStore((state) => state.redactionFill);
  const shapeStyle = useEditorStore((state) => state.shapeStyle);
  const pending = useSyncExternalStore(
    pendingSignature.subscribe,
    pendingSignature.get,
    pendingSignature.get
  );
  const ocrWords = useOcrSelector(
    (state) => state.wordsByPage[page.id] ?? NO_OCR_WORDS
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<PageBounds | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPdfTextId, setEditingPdfTextId] = useState<string | null>(null);
  const [pdfHover, setPdfHover] = useState<PdfHoverIds>(EMPTY_PDF_HOVER);
  const pdfHoverRef = useRef<PdfHoverIds>(EMPTY_PDF_HOVER);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverClientRef = useRef({ clientX: 0, clientY: 0 });
  const [editingPdfFormFieldId, setEditingPdfFormFieldId] = useState<
    string | null
  >(null);
  const [transformingId, setTransformingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OverlayDraft | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePointRef = useRef<Point | null>(null);
  const ocrDragAnchorRef = useRef<string | null>(null);
  const selectedIds = useMemo(
    () => new Set(selectedObjectIds),
    [selectedObjectIds]
  );
  const visibleWords = useMemo(
    () => visibleOcrWords(ocrWords, page.suppressedOcrWordIds),
    [ocrWords, page.suppressedOcrWordIds]
  );
  const selectedOcrIds = useMemo(
    () => new Set(selectedOcrWordIds),
    [selectedOcrWordIds]
  );
  const placingSignature = tool === "signature" && pending !== null;
  const captureTouch =
    tool === "draw" ||
    tool === "highlight" ||
    tool === "shape" ||
    tool === "redact" ||
    placingSignature;
  const pendingScaled = useMemo(
    () =>
      pending ? scaleSignaturePoints(pending, SIGNATURE_PLACE_SIZE) : null,
    [pending]
  );
  const { onPointerMove, onPointerUp, placeImage, toPage } = useOverlayGestures(
    {
      boundsRef,
      drawStyle,
      gestureRef,
      highlightColor,
      imagePointRef,
      nodeRefs,
      pageWidth: page.width,
      placingSignature,
      redactionFill,
      rootRef,
      setDraft,
      setPreviewPoint,
      setTransformingId,
      shapeStyle,
      tool,
      zoom,
    }
  );

  const clearInlineEditing = () => {
    setEditingId(null);
    setEditingPdfTextId(null);
    setEditingPdfFormFieldId(null);
  };

  const exitPdfTextEdit = useCallback(() => setEditingPdfTextId(null), []);
  const beginPdfFormEdit = useCallback((fieldId: string) => {
    setEditingPdfTextId(null);
    setEditingPdfFormFieldId(fieldId);
  }, []);
  const exitPdfFormEdit = useCallback(() => setEditingPdfFormFieldId(null), []);

  const applyPdfHover = (next: PdfHoverIds) => {
    if (samePdfHover(pdfHoverRef.current, next)) {
      return;
    }
    pdfHoverRef.current = next;
    setPdfHover(next);
  };

  const cancelHoverFrame = () => {
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
  };

  useEffect(
    () => () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
      }
    },
    []
  );

  /** Hit-test hover at most once per frame, for the latest pointer position. */
  const scheduleHover = () => {
    if (hoverFrameRef.current !== null) {
      return;
    }
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      if (gestureRef.current || !rootRef.current) {
        return;
      }
      const point = toPage(hoverClientRef.current);
      const hover = pdfHoverIdsAtPoint(
        page,
        point,
        editorStore.getState().document,
        ocrWords
      );
      if (hover.imageId && hover.imageId !== pdfHoverRef.current.imageId) {
        const image = page.pdfImageObjects.find(
          (item) => item.id === hover.imageId
        );
        if (image) {
          void ensurePdfImagePreview(image, pageKeyOf(page));
        }
      }
      applyPdfHover(hover);
    });
  };

  return (
    <div
      className={cn(
        "absolute inset-0 select-none",
        captureTouch && "touch-none",
        placingSignature && "cursor-crosshair",
        tool === "draw" && "editor-draw-cursor"
      )}
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          editorStore.clearSelection();
          clearInlineEditing();
        }
      }}
      onDoubleClick={(event) => {
        if (tool !== "select" || event.button !== 0) {
          return;
        }
        // A drag's pointer capture retargets the double-click to this root,
        // so find the overlay text box under the pointer here.
        const textId = overlayTextIdAt(
          event.currentTarget,
          event.clientX,
          event.clientY,
          page.objects
        );
        if (textId) {
          setEditingPdfTextId(null);
          setEditingId(textId);
          return;
        }
        setEditingId(null);
        const point = toPage(event);
        if (beginOcrEditAtPoint(page, point, ocrWords, setEditingId)) {
          return;
        }
        beginPdfTextEditAtPoint(page, point, setEditingPdfTextId);
      }}
      onPointerCancel={(event) => {
        ocrDragAnchorRef.current = null;
        gestureRef.current = null;
        boundsRef.current = null;
        setDraft(null);
        setTransformingId(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const root = rootRef.current;
        if (!root) {
          return;
        }
        boundsRef.current = snapshotBounds(root);
        const point = toPage(event);

        if (tool === "text") {
          // Keep the follow-up mousedown from moving focus off the new box.
          event.preventDefault();
          const object = createTextObject(
            point,
            editorStore.getState().textStyle
          );
          editorStore.addObject(object);
          setEditingId(object.id);
          setEditingPdfTextId(null);
          return;
        }

        if (tool === "image") {
          imagePointRef.current = point;
          imageInputRef.current?.click();
          return;
        }

        if (tool === "signature" && pending) {
          editorStore.addObject(
            createSignatureObject(
              scaleSignaturePoints(pending, SIGNATURE_PLACE_SIZE),
              { ...SIGNATURE_PLACE_SIZE, x: point.x, y: point.y }
            )
          );
          pendingSignature.set(null);
          setPreviewPoint(null);
          setEditingPdfTextId(null);
          return;
        }

        if (tool === "draw") {
          event.currentTarget.setPointerCapture(event.pointerId);
          gestureRef.current = { kind: "draw", points: [point] };
          return;
        }

        if (tool === "highlight" || tool === "shape" || tool === "redact") {
          event.currentTarget.setPointerCapture(event.pointerId);
          gestureRef.current = { kind: "rect", start: point };
          return;
        }

        if (event.target === event.currentTarget) {
          // Let an open inline editor commit through its own blur before the
          // selection below closes it.
          const focused = document.activeElement;
          if (
            focused instanceof HTMLElement &&
            event.currentTarget.contains(focused)
          ) {
            focused.blur();
          }
          if (tool === "select") {
            selectPdfObjectAtPoint(page, point, {
              ocrWords,
              shiftKey: event.shiftKey,
            });
            const [anchor] = editorStore.getState().selectedOcrWordIds;
            if (anchor) {
              ocrDragAnchorRef.current = anchor;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          } else {
            editorStore.clearSelection();
          }
          clearInlineEditing();
        }
      }}
      onPointerEnter={(event) => {
        if (placingSignature) {
          setPreviewPoint(toPage(event));
        }
      }}
      onPointerLeave={() => {
        cancelHoverFrame();
        applyPdfHover(EMPTY_PDF_HOVER);
      }}
      onPointerMove={(event) => {
        onPointerMove(event);
        if (tool !== "select") {
          return;
        }
        const anchor = ocrDragAnchorRef.current;
        if (anchor) {
          const over = hitTestOcrWord(visibleWords, toPage(event));
          if (!over) {
            return;
          }
          const range = ocrWordRangeIds(visibleWords, anchor, over.id);
          // Ranges are contiguous, so equal ends mean an equal selection;
          // most moves stay on the same word.
          const current = editorStore.getState().selectedOcrWordIds;
          const unchanged =
            current.length === range.length &&
            current[0] === range[0] &&
            current.at(-1) === range.at(-1);
          if (!unchanged) {
            editorStore.selectOcrWords(range);
          }
          return;
        }
        if (gestureRef.current) {
          return;
        }
        hoverClientRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
        };
        scheduleHover();
      }}
      onPointerUp={(event) => {
        ocrDragAnchorRef.current = null;
        onPointerUp(event);
      }}
      ref={rootRef}
    >
      <input
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={async (event) => {
          await placeImage(event.target.files);
          event.target.value = "";
        }}
        ref={imageInputRef}
        type="file"
      />
      <PdfAnnotationLayer
        boundsRef={boundsRef}
        gestureRef={gestureRef}
        hoveredId={pdfHover.annotationId}
        nodeRefs={nodeRefs}
        objects={page.pdfAnnotationObjects}
        onTransformStart={setTransformingId}
        page={page}
        rootRef={rootRef}
        selectedId={selectedPdfAnnotationId}
        toPage={toPage}
        transformingId={transformingId}
        zoom={zoom}
      />
      <PdfVectorLayer
        boundsRef={boundsRef}
        crop={page.cropBox}
        gestureRef={gestureRef}
        hoveredId={pdfHover.vectorId}
        nodeRefs={nodeRefs}
        objects={page.pdfVectorObjects}
        onTransformStart={setTransformingId}
        rootRef={rootRef}
        selectedId={selectedPdfVectorId}
        sourceRotate={page.sourceRotate}
        toPage={toPage}
        transformingId={transformingId}
        zoom={zoom}
      />
      <PdfImageLayer
        boundsRef={boundsRef}
        gestureRef={gestureRef}
        hoveredId={pdfHover.imageId}
        nodeRefs={nodeRefs}
        objects={page.pdfImageObjects}
        onTransformStart={setTransformingId}
        pageDocId={pageDocId(page)}
        pageSourceIndex={page.sourceIndex}
        rootRef={rootRef}
        selectedId={selectedPdfImageId}
        toPage={toPage}
        transformingId={transformingId}
        zoom={zoom}
      />
      <PdfTextLayer
        editingId={editingPdfTextId}
        hoveredId={pdfHover.textId}
        objects={page.pdfTextObjects}
        onExitEdit={exitPdfTextEdit}
        page={page}
        selectedId={selectedPdfTextId}
        zoom={zoom}
      />
      <PdfFormLayer
        editingId={editingPdfFormFieldId}
        hoveredId={pdfHover.formFieldId}
        onBeginEdit={beginPdfFormEdit}
        onExitEdit={exitPdfFormEdit}
        pageId={page.id}
        selectedId={selectedPdfFormFieldId}
        zoom={zoom}
      />
      <OcrWordLayer
        hoveredId={pdfHover.ocrWordId}
        selectedIds={selectedOcrIds}
        showRegions={showOcrRegions}
        suppressedIds={page.suppressedOcrWordIds}
        words={ocrWords}
        zoom={zoom}
      />
      {page.objects.map((object) => (
        <OverlayObject
          boundsRef={boundsRef}
          editing={editingId === object.id}
          gestureRef={gestureRef}
          key={object.id}
          nodeRefs={nodeRefs}
          object={object}
          rootRef={rootRef}
          selected={selectedIds.has(object.id)}
          setEditingId={setEditingId}
          toPage={toPage}
          tool={tool}
          zoom={zoom}
        />
      ))}
      <OverlayPreviews
        draft={draft}
        drawStyle={drawStyle}
        highlightColor={highlightColor}
        pendingScaled={pendingScaled}
        placingSignature={placingSignature}
        previewPoint={previewPoint}
        redactionFill={redactionFill}
        shapeStyle={shapeStyle}
        tool={tool}
        zoom={zoom}
      />
    </div>
  );
};
