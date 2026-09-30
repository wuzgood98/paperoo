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
import { OverlayPreviews } from "@/components/editor/overlay-previews";
import { PdfImageLayer } from "@/components/editor/pdf-image-layer";
import { PdfTextLayer } from "@/components/editor/pdf-text-layer";
import type { PageBounds } from "@/lib/editor/coordinates";
import {
  createSignatureObject,
  createTextObject,
  hitTestPdfImage,
  hitTestPdfText,
  scaleSignaturePoints,
  SIGNATURE_PLACE_SIZE,
} from "@/lib/editor/object-utils";
import { pendingSignature } from "@/lib/editor/pending";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorPage, Point } from "@/lib/editor/types";
import { ensurePdfImagePreview } from "@/lib/pdf/pdf-image-preview";
import { cn } from "@/lib/utils";

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
  const [hoveredPdfImageId, setHoveredPdfImageId] = useState<string | null>(
    null
  );
  const [hoveredPdfTextId, setHoveredPdfTextId] = useState<string | null>(null);
  const [transformingPdfImageId, setTransformingPdfImageId] = useState<
    string | null
  >(null);
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
      setTransformingId: setTransformingPdfImageId,
      shapeStyle,
      tool,
      zoom,
    }
  );

  return (
    <div
      className={cn(
        "absolute inset-0 touch-none select-none",
        placingSignature && "cursor-crosshair"
      )}
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          editorStore.clearSelection();
        }
      }}
      onPointerCancel={(event) => {
        gestureRef.current = null;
        setDraft(null);
        setTransformingPdfImageId(null);
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
          return;
        }

        if (tool === "image") {
          imagePointRef.current = point;
          imageInputRef.current?.click();
          return;
        }

        if (tool === "signature" && pending) {
          const box = {
            ...SIGNATURE_PLACE_SIZE,
            x: point.x,
            y: point.y,
          };
          editorStore.addObject(
            createSignatureObject(
              scaleSignaturePoints(pending, SIGNATURE_PLACE_SIZE),
              box
            )
          );
          pendingSignature.set(null);
          setPreviewPoint(null);
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
            const textHit = hitTestPdfText(page.pdfTextObjects, point);
            if (textHit) {
              editorStore.selectPdfText(textHit.id);
              setEditingId(null);
              return;
            }
            const imageHit = hitTestPdfImage(page.pdfImageObjects, point);
            if (imageHit) {
              editorStore.selectPdfImage(imageHit.id);
              void ensurePdfImagePreview(imageHit, page.sourceIndex);
              setEditingId(null);
              return;
            }
          }
          editorStore.clearSelection();
          setEditingId(null);
        }
      }}
      onPointerEnter={(event) => {
        if (placingSignature) {
          setPreviewPoint(toPage(event));
        }
      }}
      onPointerLeave={() => {
        setHoveredPdfImageId(null);
        setHoveredPdfTextId(null);
      }}
      onPointerMove={(event) => {
        onPointerMove(event);
        if (tool !== "select" || gestureRef.current) {
          return;
        }
        const point = toPage(event);
        const textHit = hitTestPdfText(page.pdfTextObjects, point);
        const nextTextId = textHit?.id ?? null;
        setHoveredPdfTextId((current) =>
          current === nextTextId ? current : nextTextId
        );
        const imageHit = textHit
          ? undefined
          : hitTestPdfImage(page.pdfImageObjects, point);
        const nextImageId = imageHit?.id ?? null;
        if (imageHit && imageHit.id !== hoveredPdfImageId) {
          void ensurePdfImagePreview(imageHit, page.sourceIndex);
        }
        setHoveredPdfImageId((current) =>
          current === nextImageId ? current : nextImageId
        );
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
      <PdfImageLayer
        boundsRef={boundsRef}
        gestureRef={gestureRef}
        hoveredId={hoveredPdfImageId}
        nodeRefs={nodeRefs}
        objects={page.pdfImageObjects}
        onTransformStart={setTransformingPdfImageId}
        pageSourceIndex={page.sourceIndex}
        rootRef={rootRef}
        selectedId={selectedPdfImageId}
        toPage={toPage}
        transformingId={transformingPdfImageId}
        zoom={zoom}
      />
      <PdfTextLayer
        hoveredId={hoveredPdfTextId}
        objects={page.pdfTextObjects}
        selectedId={selectedPdfTextId}
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
