import { useCallback, useLayoutEffect, useRef } from "react";
import type { Dispatch, PointerEvent, SetStateAction } from "react";

import { toastManager } from "@/components/ui/toast-manager";
import {
  objectCenter,
  objectWrapperStyle,
  resizeRotatedBox,
  screenToPage,
} from "@/lib/editor/coordinates";
import type { PageBounds, ResizeHandle } from "@/lib/editor/coordinates";
import {
  boundsFromPoints,
  createDrawingObject,
  createHighlightObject,
  createImageObject,
  createShapeObject,
  isClickDrag,
  isRisingDrag,
  normalizedRect,
  pdfAnnotationWithGestureBox,
  pdfImageWithGestureBox,
  pdfVectorWithGestureBox,
  scaleObjectToBox,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import { MIN_CREATE_DRAG, MIN_OBJECT_SIZE } from "@/lib/editor/types";
import type {
  DrawStyleDefaults,
  EditorObject,
  EditorTool,
  PdfAnnotationObject,
  PdfImageObject,
  PdfVectorObject,
  Point,
  ShapeStyleDefaults,
} from "@/lib/editor/types";
import { readImageFile } from "@/lib/pdf/image-file";

export type GestureTarget =
  | EditorObject
  | PdfAnnotationObject
  | PdfImageObject
  | PdfVectorObject;

const isPdfAnnotationGestureTarget = (
  object: GestureTarget
): object is PdfAnnotationObject => "sourceRef" in object;

export type OverlayDraft =
  | { kind: "draw"; points: Point[] }
  | { kind: "rect"; end: Point; start: Point };

export type Gesture =
  | {
      handle: ResizeHandle;
      kind: "resize";
      object: GestureTarget;
      start: Point;
    }
  | { kind: "draw"; points: Point[] }
  | { kind: "drag"; object: GestureTarget; start: Point; origin: Point }
  | { kind: "rect"; start: Point }
  | {
      kind: "rotate";
      object: GestureTarget;
      startAngle: number;
      originRotation: number;
    };

interface RefBox<T> {
  current: T;
}

export const requireOverlayRoot = (
  element: HTMLDivElement | null
): HTMLElement => {
  if (!element) {
    throw new Error("Editor overlay is not mounted");
  }
  return element;
};

export const snapshotBounds = (element: HTMLElement): PageBounds => {
  const rect = element.getBoundingClientRect();
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
};

export const useOverlayGestures = ({
  boundsRef,
  drawStyle,
  gestureRef,
  highlightColor,
  imagePointRef,
  nodeRefs,
  pageWidth,
  placingSignature,
  rootRef,
  setDraft,
  setPreviewPoint,
  setTransformingId,
  shapeStyle,
  tool,
  zoom,
}: {
  boundsRef: RefBox<PageBounds | null>;
  drawStyle: DrawStyleDefaults;
  gestureRef: RefBox<Gesture | null>;
  highlightColor: string;
  imagePointRef: RefBox<Point | null>;
  nodeRefs: RefBox<Map<string, HTMLDivElement>>;
  pageWidth: number;
  placingSignature: boolean;
  rootRef: RefBox<HTMLDivElement | null>;
  setDraft: Dispatch<SetStateAction<OverlayDraft | null>>;
  setPreviewPoint: Dispatch<SetStateAction<Point | null>>;
  setTransformingId: Dispatch<SetStateAction<string | null>>;
  shapeStyle: ShapeStyleDefaults;
  tool: EditorTool;
  zoom: number;
}) => {
  // Stable per zoom so memoized layers that receive it can skip re-renders.
  const toPage = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      // The pointerdown snapshot only holds for an in-flight gesture; hover and
      // clicks after a scroll or zoom need the page's current position.
      const cached = gestureRef.current ? boundsRef.current : null;
      const bounds =
        cached ?? snapshotBounds(requireOverlayRoot(rootRef.current));
      return screenToPage({ x: event.clientX, y: event.clientY }, bounds, zoom);
    },
    [boundsRef, gestureRef, rootRef, zoom]
  );
  const draftFrameRef = useRef<number | null>(null);

  /** Copy the stroke into React state at most once per frame. */
  const scheduleDrawDraft = (): void => {
    if (draftFrameRef.current !== null) {
      return;
    }
    draftFrameRef.current = requestAnimationFrame(() => {
      draftFrameRef.current = null;
      const gesture = gestureRef.current;
      if (gesture?.kind === "draw") {
        setDraft({ kind: "draw", points: [...gesture.points] });
      }
    });
  };

  const writeNodeBox = (
    object: Pick<
      GestureTarget,
      "height" | "id" | "rotation" | "width" | "x" | "y"
    >
  ): void => {
    const node = nodeRefs.current.get(object.id);
    if (!node) {
      return;
    }
    const style = objectWrapperStyle(object, zoom);
    node.style.left = `${style.left}px`;
    node.style.top = `${style.top}px`;
    node.style.width = `${style.width}px`;
    node.style.height = `${style.height}px`;
    node.style.transform = `rotate(${object.rotation}deg)`;
  };

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (
      !gesture ||
      (gesture.kind !== "drag" &&
        gesture.kind !== "resize" &&
        gesture.kind !== "rotate")
    ) {
      return;
    }
    writeNodeBox(gesture.object);
  });

  const finishGesture = (object: GestureTarget | null): void => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    boundsRef.current = null;
    setTransformingId(null);
    if (
      !object ||
      !gesture ||
      gesture.kind === "draw" ||
      gesture.kind === "rect"
    ) {
      return;
    }
    if (object.type === "pdf-image") {
      const current = editorStore.selectedPdfImage();
      editorStore.commitPdfImage(
        current && current.id === object.id
          ? pdfImageWithGestureBox(current, object)
          : object,
        true
      );
      return;
    }
    if (object.type === "pdf-vector") {
      const current = editorStore.selectedPdfVector();
      editorStore.commitPdfVector(
        current && current.id === object.id
          ? pdfVectorWithGestureBox(current, object)
          : object,
        true
      );
      return;
    }
    if (isPdfAnnotationGestureTarget(object)) {
      const current = editorStore.selectedPdfAnnotation();
      editorStore.commitPdfAnnotation(
        current && current.id === object.id
          ? pdfAnnotationWithGestureBox(current, object)
          : object,
        true
      );
      return;
    }
    editorStore.commitObject(object.id, object, true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (placingSignature) {
      setPreviewPoint(toPage(event));
    }
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }
    const point = toPage(event);

    if (gesture.kind === "drag") {
      const next = {
        ...gesture.object,
        x: gesture.origin.x + (point.x - gesture.start.x),
        y: gesture.origin.y + (point.y - gesture.start.y),
      };
      gesture.object = next;
      writeNodeBox(next);
      return;
    }

    if (gesture.kind === "resize") {
      const nextBox = resizeRotatedBox(
        gesture.object,
        gesture.object.rotation,
        gesture.handle,
        point,
        {
          lockAspect:
            event.shiftKey ||
            gesture.object.type === "image" ||
            gesture.object.type === "pdf-image",
          minSize: MIN_OBJECT_SIZE,
        }
      );
      const next = { ...gesture.object, ...nextBox };
      gesture.object = next;
      writeNodeBox(next);
      return;
    }

    if (gesture.kind === "rotate") {
      const center = objectCenter(gesture.object);
      const angle =
        (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
      const next = {
        ...gesture.object,
        rotation: gesture.originRotation + (angle - gesture.startAngle),
      };
      writeNodeBox(next);
      gesture.object = next;
      return;
    }

    if (gesture.kind === "draw") {
      // Constructed events report an empty list, not a missing method.
      const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
      const samples = coalesced.length > 0 ? coalesced : [event.nativeEvent];
      for (const sample of samples) {
        gesture.points.push(toPage(sample));
      }
      scheduleDrawDraft();
      return;
    }

    if (gesture.kind === "rect") {
      setDraft({ end: point, kind: "rect", start: gesture.start });
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDraft(null);
    const point = toPage(event);

    if (gesture.kind === "drag") {
      const next = {
        ...gesture.object,
        x: gesture.origin.x + (point.x - gesture.start.x),
        y: gesture.origin.y + (point.y - gesture.start.y),
      };
      finishGesture(next);
      return;
    }
    if (gesture.kind === "resize") {
      const nextBox = resizeRotatedBox(
        gesture.object,
        gesture.object.rotation,
        gesture.handle,
        point,
        {
          lockAspect:
            event.shiftKey ||
            gesture.object.type === "image" ||
            gesture.object.type === "pdf-image",
          minSize: MIN_OBJECT_SIZE,
        }
      );
      if (
        gesture.object.type === "pdf-image" ||
        gesture.object.type === "pdf-vector" ||
        gesture.object.type === "pdf-free-text"
      ) {
        finishGesture({ ...gesture.object, ...nextBox });
        return;
      }
      if (!isPdfAnnotationGestureTarget(gesture.object)) {
        finishGesture(scaleObjectToBox(gesture.object, nextBox));
      }
      return;
    }
    if (gesture.kind === "rotate") {
      finishGesture(gesture.object);
      return;
    }
    if (gesture.kind === "draw") {
      finishGesture(null);
      const box = boundsFromPoints(gesture.points);
      if (Math.max(box.width, box.height) < MIN_CREATE_DRAG) {
        return;
      }
      editorStore.addObject(
        createDrawingObject(
          gesture.points,
          drawStyle.stroke,
          drawStyle.strokeWidth
        ),
        { keepTool: true }
      );
      return;
    }
    if (gesture.kind === "rect") {
      gestureRef.current = null;
      boundsRef.current = null;
      const isLine = tool === "shape" && shapeStyle.shape === "line";
      if (isClickDrag(gesture.start, point, isLine)) {
        return;
      }
      const rect = normalizedRect(gesture.start, point);
      editorStore.addObject(
        tool === "highlight"
          ? createHighlightObject(rect, highlightColor)
          : createShapeObject(
              rect,
              shapeStyle,
              isRisingDrag(gesture.start, point)
            ),
        { keepTool: true }
      );
    }
  };

  const placeImage = async (files: FileList | null) => {
    const file = files?.[0];
    const point = imagePointRef.current;
    imagePointRef.current = null;
    if (!file || !point) {
      return;
    }
    try {
      const image = await readImageFile(file);
      const maxWidth = pageWidth * 0.4;
      const scale = Math.min(1, maxWidth / image.width);
      const asset = editorStore.addAsset(image.bytes, image.mimeType);
      editorStore.addObject(
        createImageObject(
          point,
          { height: image.height * scale, width: image.width * scale },
          asset.id,
          image.mimeType
        )
      );
    } catch (error) {
      toastManager.add({
        description:
          error instanceof Error ? error.message : "Could not add image.",
        title: "Image failed",
        type: "error",
      });
    }
  };

  return { onPointerMove, onPointerUp, placeImage, toPage };
};
