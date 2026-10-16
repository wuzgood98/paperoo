"use client";

import type { RefObject } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
  requireOverlayRoot,
  snapshotBounds,
} from "@/components/editor/overlay-gestures";
import type { Gesture } from "@/components/editor/overlay-gestures";
import { SelectionBox } from "@/components/editor/selection-box";
import { activatePdfLinkAction } from "@/lib/editor/annotation-links";
import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import type { PageBounds } from "@/lib/editor/coordinates";
import {
  isPdfMarkupAnnotation,
  shouldPaintPdfAnnotationPreview,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorPage,
  PdfAnnotationObject,
  PdfFreeTextAnnotation,
  Point,
} from "@/lib/editor/types";
import { getDisplayedPageContentCanvas } from "@/lib/pdf/pdf-annotation-content-cache";
import { cn } from "@/lib/utils";

interface RefBox<T> {
  current: T;
}

const quadStyle = (
  quad: { height: number; width: number; x: number; y: number },
  zoom: number
) => ({
  height: pageToCss(quad.height, zoom),
  left: pageToCss(quad.x, zoom),
  top: pageToCss(quad.y, zoom),
  width: pageToCss(quad.width, zoom),
});

const MarkupPreview = ({
  object,
  zoom,
}: {
  object: PdfAnnotationObject;
  zoom: number;
}) => {
  if (!isPdfMarkupAnnotation(object)) {
    return null;
  }
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      style={{
        mixBlendMode: object.type === "pdf-highlight" ? "multiply" : undefined,
      }}
    >
      {object.quads.map((quad) => (
        <rect
          fill={object.type === "pdf-highlight" ? object.color : "transparent"}
          height={pageToCss(quad.height, zoom)}
          key={`${quad.x}-${quad.y}`}
          stroke={object.type === "pdf-highlight" ? "none" : object.color}
          strokeWidth={object.type === "pdf-highlight" ? 0 : 2}
          width={pageToCss(quad.width, zoom)}
          x={pageToCss(quad.x, zoom)}
          y={pageToCss(quad.y, zoom)}
        />
      ))}
    </svg>
  );
};

const FreeTextPreview = ({
  object,
  zoom,
}: {
  object: PdfFreeTextAnnotation;
  zoom: number;
}) => (
  <div
    className="pointer-events-none h-full w-full p-1 text-left whitespace-pre-wrap"
    style={{
      color: object.fontColor,
      fontSize: pageToCss(object.fontSize, zoom),
      lineHeight: 1.35,
    }}
  >
    {object.contents}
  </div>
);

const PdfAnnotationDirtyBackdrop = ({
  page,
  zoom,
}: {
  page: EditorPage;
  zoom: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Memoized so the canvas copy below reruns only when annotations change.
  const dirty = useMemo(
    () => page.pdfAnnotationObjects.filter(shouldPaintPdfAnnotationPreview),
    [page.pdfAnnotationObjects]
  );

  const { sourceIndex, sourceRotate, width: pageWidth } = page;

  useEffect(() => {
    if (dirty.length === 0) {
      return;
    }
    let cancelled = false;
    const draw = async () => {
      // Displayed space: this canvas sits in the overlay, which the page
      // frame rotates with CSS, and regions are displayed rects.
      const source = await getDisplayedPageContentCanvas(
        { sourceIndex, sourceRotate },
        zoom
      );
      const canvas = canvasRef.current;
      if (!source || !canvas || cancelled) {
        return;
      }
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.style.width = source.style.width;
      canvas.style.height = source.style.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ratio = source.width / Math.max(1, pageWidth * zoom);
      for (const object of dirty) {
        const regions =
          "quads" in object && object.quads.length > 0
            ? object.quads
            : [object];
        for (const region of regions) {
          const sx = Math.floor(region.x * zoom * ratio);
          const sy = Math.floor(region.y * zoom * ratio);
          const sw = Math.ceil(region.width * zoom * ratio);
          const sh = Math.ceil(region.height * zoom * ratio);
          ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
        }
      }
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [dirty, pageWidth, sourceIndex, sourceRotate, zoom]);

  if (dirty.length === 0) {
    return null;
  }
  return (
    <canvas
      className="pointer-events-none absolute inset-0 h-full w-full"
      ref={canvasRef}
    />
  );
};

const canDragAnnotation = (object: PdfAnnotationObject): boolean =>
  object.type === "pdf-free-text" ||
  object.type === "pdf-text-note" ||
  (object.type === "pdf-stamp" && object.appearanceTranslatable);

const canResizeAnnotation = (object: PdfAnnotationObject): boolean =>
  object.type === "pdf-free-text";

const AnnotationPreviewContent = ({
  object,
  zoom,
}: {
  object: PdfAnnotationObject;
  zoom: number;
}) => {
  if (isPdfMarkupAnnotation(object)) {
    return <MarkupPreview object={object} zoom={zoom} />;
  }
  if (object.type === "pdf-free-text") {
    return (
      <div
        className="absolute origin-top-left"
        style={objectWrapperStyle(object, zoom)}
      >
        <FreeTextPreview object={object} zoom={zoom} />
      </div>
    );
  }
  return null;
};

const PdfAnnotationLayerView = ({
  boundsRef,
  gestureRef,
  hoveredId,
  nodeRefs,
  objects,
  onTransformStart,
  page,
  rootRef,
  selectedId,
  toPage,
  transformingId: _transformingId,
  zoom,
}: {
  boundsRef: RefBox<PageBounds | null>;
  gestureRef: RefBox<Gesture | null>;
  hoveredId: string | null;
  nodeRefs: RefBox<Map<string, HTMLDivElement>>;
  objects: readonly PdfAnnotationObject[];
  onTransformStart: (objectId: string) => void;
  page: EditorPage;
  rootRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  toPage: (event: { clientX: number; clientY: number }) => Point;
  transformingId: string | null;
  zoom: number;
}) => {
  const [, setTick] = useState(0);

  return (
    <>
      <PdfAnnotationDirtyBackdrop page={page} zoom={zoom} />
      {objects.map((object) =>
        shouldPaintPdfAnnotationPreview(object) ? (
          <div
            className="pointer-events-none absolute inset-0"
            key={`preview-${object.id}`}
          >
            <AnnotationPreviewContent object={object} zoom={zoom} />
          </div>
        ) : null
      )}
      {objects.map((object) => {
        if (object.deleted) {
          return null;
        }
        const regions =
          "quads" in object && object.quads.length > 0
            ? object.quads
            : [object];
        return regions.map((quad, index) => (
          <div
            className={cn(
              "absolute",
              object.type === "pdf-link" ? "cursor-pointer" : "cursor-default"
            )}
            key={`hit-${object.id}-${index}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (object.type === "pdf-link" && !event.shiftKey) {
                activatePdfLinkAction(
                  object.action,
                  editorStore.getState().document,
                  (pageId) => editorStore.setCurrentPage(pageId),
                  page.id
                );
                return;
              }
              boundsRef.current = snapshotBounds(
                requireOverlayRoot(rootRef.current)
              );
              editorStore.selectPdfAnnotation(object.id);
              if (canDragAnnotation(object)) {
                rootRef.current?.setPointerCapture(event.pointerId);
                onTransformStart(object.id);
                gestureRef.current = {
                  kind: "drag",
                  object,
                  origin: { x: object.x, y: object.y },
                  start: toPage(event),
                };
              }
            }}
            style={{
              ...quadStyle(quad, zoom),
              background:
                object.id === hoveredId && object.type === "pdf-link"
                  ? "rgba(59,130,246,0.12)"
                  : "transparent",
            }}
          />
        ));
      })}
      {objects.map((object) => {
        if (object.deleted || object.id !== selectedId) {
          return null;
        }
        if (!canDragAnnotation(object) && !isPdfMarkupAnnotation(object)) {
          return null;
        }
        if (isPdfMarkupAnnotation(object)) {
          return (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              key={`sel-${object.id}`}
            >
              {object.quads.map((quad) => (
                <rect
                  className="stroke-primary"
                  fill="none"
                  height={pageToCss(quad.height, zoom)}
                  key={`sel-${quad.x}`}
                  strokeWidth={2}
                  width={pageToCss(quad.width, zoom)}
                  x={pageToCss(quad.x, zoom)}
                  y={pageToCss(quad.y, zoom)}
                />
              ))}
            </svg>
          );
        }
        return (
          <div
            className="absolute origin-center cursor-move"
            key={`selected-${object.id}`}
            ref={(node) => {
              if (node) {
                nodeRefs.current.set(object.id, node);
              } else {
                nodeRefs.current.delete(object.id);
              }
            }}
            style={objectWrapperStyle(object, zoom)}
          >
            {object.type === "pdf-free-text" &&
            shouldPaintPdfAnnotationPreview(object) ? (
              <FreeTextPreview object={object} zoom={zoom} />
            ) : null}
            {canResizeAnnotation(object) ? (
              <SelectionBox
                onResizePointerDown={(handle, event) => {
                  event.stopPropagation();
                  boundsRef.current = snapshotBounds(
                    requireOverlayRoot(rootRef.current)
                  );
                  rootRef.current?.setPointerCapture(event.pointerId);
                  onTransformStart(object.id);
                  gestureRef.current = {
                    handle,
                    kind: "resize",
                    object,
                    start: toPage(event),
                  };
                }}
                onRotatePointerDown={() => {
                  setTick((value) => value + 1);
                }}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
};

/** Memoized: the overlay re-renders on hover and selection changes this layer may not use. */
export const PdfAnnotationLayer = memo(PdfAnnotationLayerView);
