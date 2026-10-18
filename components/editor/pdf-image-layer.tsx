"use client";

import Image from "next/image";
import { memo } from "react";
import type { RefObject } from "react";

import {
  requireOverlayRoot,
  snapshotBounds,
} from "@/components/editor/overlay-gestures";
import type { Gesture } from "@/components/editor/overlay-gestures";
import { SelectionBox } from "@/components/editor/selection-box";
import { objectCenter, objectWrapperStyle } from "@/lib/editor/coordinates";
import type { PageBounds } from "@/lib/editor/coordinates";
import {
  pdfImageAssetId,
  pdfImageCoverBox,
  shouldPaintPdfImageCover,
  shouldPaintPdfImagePreview,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { PdfImageObject, Point } from "@/lib/editor/types";
import {
  capturePdfImagePreviewFromCanvas,
  ensurePdfImagePreview,
} from "@/lib/pdf/pdf-image-preview";
import { cn } from "@/lib/utils";

interface RefBox<T> {
  current: T;
}

const PdfImagePreview = ({
  object,
  zoom,
}: {
  object: PdfImageObject;
  zoom: number;
}) => {
  const assetId = pdfImageAssetId(object);
  const asset = assetId ? editorStore.getAsset(assetId) : undefined;
  if (!asset) {
    return null;
  }
  return (
    <div className="relative h-full w-full">
      <Image
        alt=""
        className="pointer-events-none object-fill [-webkit-user-drag:none]"
        draggable={false}
        fill
        onDragStart={(event) => {
          event.preventDefault();
        }}
        sizes={`${Math.max(1, Math.round(object.width * zoom))}px`}
        src={asset.objectUrl}
        unoptimized
      />
    </div>
  );
};

const PdfImageLayerView = ({
  boundsRef,
  gestureRef,
  hoveredId,
  nodeRefs,
  objects,
  onTransformStart,
  pageDocId,
  pageSourceIndex,
  rootRef,
  selectedId,
  toPage,
  transformingId,
  zoom,
}: {
  boundsRef: RefBox<PageBounds | null>;
  gestureRef: RefBox<Gesture | null>;
  hoveredId: string | null;
  nodeRefs: RefBox<Map<string, HTMLDivElement>>;
  objects: readonly PdfImageObject[];
  onTransformStart: (objectId: string) => void;
  pageDocId: string;
  pageSourceIndex: number;
  rootRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  toPage: (event: { clientX: number; clientY: number }) => Point;
  transformingId: string | null;
  zoom: number;
}) => (
  <>
    {objects.map((object) =>
      shouldPaintPdfImageCover(object, transformingId) ? (
        <div
          className="pointer-events-none absolute origin-center bg-white"
          key={`cover-${object.id}`}
          style={objectWrapperStyle(pdfImageCoverBox(object), zoom)}
        />
      ) : null
    )}
    {objects.map((object) => {
      if (object.id === selectedId) {
        return null;
      }
      if (!shouldPaintPdfImagePreview(object, transformingId)) {
        return null;
      }
      return (
        <div
          className="pointer-events-none absolute origin-center"
          key={`dirty-${object.id}`}
          style={objectWrapperStyle(object, zoom)}
        >
          <PdfImagePreview object={object} zoom={zoom} />
        </div>
      );
    })}
    {objects.map((object) => {
      if (object.deleted) {
        return null;
      }
      const hovered = object.id === hoveredId;
      const selected = object.id === selectedId;
      if (selected) {
        return (
          <div
            className="absolute origin-center cursor-move"
            key={`selected-${object.id}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              boundsRef.current = snapshotBounds(
                requireOverlayRoot(rootRef.current)
              );
              rootRef.current?.setPointerCapture(event.pointerId);
              editorStore.selectPdfImage(object.id);
              capturePdfImagePreviewFromCanvas(object, rootRef.current, zoom);
              void ensurePdfImagePreview(object, {
                docId: pageDocId,
                sourceIndex: pageSourceIndex,
              });
              onTransformStart(object.id);
              gestureRef.current = {
                kind: "drag",
                object,
                origin: { x: object.x, y: object.y },
                start: toPage(event),
              };
            }}
            ref={(node) => {
              if (node) {
                nodeRefs.current.set(object.id, node);
              } else {
                nodeRefs.current.delete(object.id);
              }
            }}
            style={objectWrapperStyle(object, zoom)}
          >
            {shouldPaintPdfImagePreview(object, transformingId) ? (
              <PdfImagePreview object={object} zoom={zoom} />
            ) : null}
            <SelectionBox
              onResizePointerDown={(handle, event) => {
                event.stopPropagation();
                boundsRef.current = snapshotBounds(
                  requireOverlayRoot(rootRef.current)
                );
                rootRef.current?.setPointerCapture(event.pointerId);
                capturePdfImagePreviewFromCanvas(object, rootRef.current, zoom);
                void ensurePdfImagePreview(object, {
                  docId: pageDocId,
                  sourceIndex: pageSourceIndex,
                });
                onTransformStart(object.id);
                gestureRef.current = {
                  handle,
                  kind: "resize",
                  object,
                  origin: object,
                };
              }}
              onRotatePointerDown={(event) => {
                event.stopPropagation();
                boundsRef.current = snapshotBounds(
                  requireOverlayRoot(rootRef.current)
                );
                rootRef.current?.setPointerCapture(event.pointerId);
                capturePdfImagePreviewFromCanvas(object, rootRef.current, zoom);
                void ensurePdfImagePreview(object, {
                  docId: pageDocId,
                  sourceIndex: pageSourceIndex,
                });
                onTransformStart(object.id);
                const center = objectCenter(object);
                const point = toPage(event);
                gestureRef.current = {
                  kind: "rotate",
                  object,
                  originRotation: object.rotation,
                  startAngle:
                    (Math.atan2(point.y - center.y, point.x - center.x) * 180) /
                    Math.PI,
                };
              }}
            />
          </div>
        );
      }
      if (!hovered) {
        return null;
      }
      return (
        <div
          className={cn(
            "pointer-events-none absolute origin-center",
            "outline-primary/40 outline"
          )}
          key={`hover-${object.id}`}
          style={objectWrapperStyle(object, zoom)}
        />
      );
    })}
  </>
);

/** Memoized: the overlay re-renders on hover and selection changes this layer may not use. */
export const PdfImageLayer = memo(PdfImageLayerView);
