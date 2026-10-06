"use client";

import { useRef, useState, useSyncExternalStore } from "react";

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
  beginPdfTextEditAtPoint,
  EMPTY_PDF_HOVER,
  pdfHoverIdsAtPoint,
  selectPdfObjectAtPoint,
} from "@/components/editor/overlay-pdf-hit";
import type { PdfHoverIds } from "@/components/editor/overlay-pdf-hit";
import { OverlayPreviews } from "@/components/editor/overlay-previews";
import { PdfAnnotationLayer } from "@/components/editor/pdf-annotation-layer";
import { PdfFormLayer } from "@/components/editor/pdf-form-layer";
import { PdfImageLayer } from "@/components/editor/pdf-image-layer";
import { PdfTextLayer } from "@/components/editor/pdf-text-layer";
import { PdfVectorLayer } from "@/components/editor/pdf-vector-layer";
import { normalizeRotation } from "@/lib/editor/coordinates";
import type { PageBounds } from "@/lib/editor/coordinates";
import {
  createSignatureObject,
  createTextObject,
  scaleSignaturePoints,
  SIGNATURE_PLACE_SIZE,
} from "@/lib/editor/object-utils";
import { pendingSignature } from "@/lib/editor/pending";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorPage, Point } from "@/lib/editor/types";
import { ensurePdfImagePreview } from "@/lib/pdf/pdf-image-preview";
import { cn } from "@/lib/utils";

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
  const editorDocument = useEditorStore((state) => state.document);
  const drawStyle = useEditorStore((state) => state.drawStyle);
  const highlightColor = useEditorStore((state) => state.highlightColor);
  const shapeStyle = useEditorStore((state) => state.shapeStyle);
  const pending = useSyncExternalStore(
    pendingSignature.subscribe,
    pendingSignature.get,
    pendingSignature.get
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<PageBounds | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPdfTextId, setEditingPdfTextId] = useState<string | null>(null);
  const [pdfHover, setPdfHover] = useState<PdfHoverIds>(EMPTY_PDF_HOVER);
  const [editingPdfFormFieldId, setEditingPdfFormFieldId] = useState<
    string | null
  >(null);
  const [transformingId, setTransformingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OverlayDraft | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePointRef = useRef<Point | null>(null);
  const selectedIds = new Set(selectedObjectIds);
  const placingSignature = tool === "signature" && pending !== null;
  const pendingScaled = pending
    ? scaleSignaturePoints(pending, SIGNATURE_PLACE_SIZE)
    : null;
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

  return (
    <div
      className={cn(
        "absolute inset-0 touch-none select-none",
        placingSignature && "cursor-crosshair"
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
        setEditingId(null);
        beginPdfTextEditAtPoint(page, toPage(event), setEditingPdfTextId);
      }}
      onPointerCancel={(event) => {
        gestureRef.current = null;
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

        if (tool === "highlight" || tool === "shape") {
          event.currentTarget.setPointerCapture(event.pointerId);
          gestureRef.current = { kind: "rect", start: point };
          return;
        }

        if (event.target === event.currentTarget) {
          if (tool === "select") {
            selectPdfObjectAtPoint(page, point, {
              shiftKey: event.shiftKey,
            });
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
        setPdfHover(EMPTY_PDF_HOVER);
      }}
      onPointerMove={(event) => {
        onPointerMove(event);
        if (tool !== "select" || gestureRef.current) {
          return;
        }
        const hover = pdfHoverIdsAtPoint(page, toPage(event), editorDocument);
        if (hover.imageId && hover.imageId !== pdfHover.imageId) {
          const image = page.pdfImageObjects.find(
            (item) => item.id === hover.imageId
          );
          if (image) {
            void ensurePdfImagePreview(image, page.sourceIndex);
          }
        }
        setPdfHover(hover);
      }}
      onPointerUp={onPointerUp}
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
        canvasRotation={normalizeRotation(page.sourceRotate + page.rotation)}
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
        onExitEdit={() => {
          setEditingPdfTextId(null);
        }}
        page={page}
        selectedId={selectedPdfTextId}
        zoom={zoom}
      />
      <PdfFormLayer
        editingId={editingPdfFormFieldId}
        hoveredId={pdfHover.formFieldId}
        onBeginEdit={(fieldId) => {
          setEditingPdfTextId(null);
          setEditingPdfFormFieldId(fieldId);
        }}
        onExitEdit={() => {
          setEditingPdfFormFieldId(null);
        }}
        pageId={page.id}
        selectedId={selectedPdfFormFieldId}
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
        shapeStyle={shapeStyle}
        tool={tool}
        zoom={zoom}
      />
    </div>
  );
};
