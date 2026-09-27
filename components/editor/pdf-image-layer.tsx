"use client";

import Image from "next/image";
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
  isPdfImageDirty,
  pdfImageOriginalBox,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { PdfImageObject, Point } from "@/lib/editor/types";
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
  const assetId = object.replacementAssetId ?? object.previewAssetId;
  const asset = assetId ? editorStore.getAsset(assetId) : undefined;
  if (!asset) {
    return <div className="bg-muted h-full w-full" />;
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

export const PdfImageLayer = ({
  boundsRef,
  gestureRef,
  hoveredId,
  nodeRefs,
  objects,
  rootRef,
  selectedId,
  toPage,
  zoom,
}: {
  boundsRef: RefBox<PageBounds | null>;
  gestureRef: RefBox<Gesture | null>;
  hoveredId: string | null;
  nodeRefs: RefBox<Map<string, HTMLDivElement>>;
  objects: readonly PdfImageObject[];
  rootRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  toPage: (event: { clientX: number; clientY: number }) => Point;
  zoom: number;
}) => (
  <>
    {objects.map((object) =>
      isPdfImageDirty(object) ? (
        <div
          className="pointer-events-none absolute origin-center bg-white"
          key={`cover-${object.id}`}
          style={objectWrapperStyle(pdfImageOriginalBox(object), zoom)}
        />
      ) : null
    )}
    {objects.map((object) => {
      if (object.deleted || !isPdfImageDirty(object)) {
        return null;
      }
      const selected = object.id === selectedId;
      if (selected) {
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
            <PdfImagePreview object={object} zoom={zoom} />
            <SelectionBox
              onResizePointerDown={(handle, event) => {
                event.stopPropagation();
                boundsRef.current = snapshotBounds(
                  requireOverlayRoot(rootRef.current)
                );
                rootRef.current?.setPointerCapture(event.pointerId);
                gestureRef.current = {
                  handle,
                  kind: "resize",
                  object,
                  start: toPage(event),
                };
              }}
              onRotatePointerDown={(event) => {
                event.stopPropagation();
                boundsRef.current = snapshotBounds(
                  requireOverlayRoot(rootRef.current)
                );
                rootRef.current?.setPointerCapture(event.pointerId);
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
