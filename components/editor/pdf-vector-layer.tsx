"use client";

import { memo } from "react";
import type { RefObject } from "react";

import {
  requireOverlayRoot,
  snapshotBounds,
} from "@/components/editor/overlay-gestures";
import type { Gesture } from "@/components/editor/overlay-gestures";
import { SelectionBox } from "@/components/editor/selection-box";
import {
  objectCenter,
  objectWrapperStyle,
  userPointToDisplayed,
  vectorAxisScale,
  vectorStrokeScale,
} from "@/lib/editor/coordinates";
import type { PageBounds } from "@/lib/editor/coordinates";
import {
  pdfVectorCoverGeometry,
  pdfVectorCoverPathStyle,
  pdfVectorPreviewBox,
  pdfVectorStrokePad,
  shouldPaintPdfVectorCover,
  shouldPaintPdfVectorPreview,
} from "@/lib/editor/object-utils";
import type { PdfVectorCoverPathStyle } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  CropBox,
  PageRotation,
  PdfPathCommand,
  PdfVectorObject,
  Point,
} from "@/lib/editor/types";
import { cn } from "@/lib/utils";

interface RefBox<T> {
  current: T;
}

type PathBox = Pick<
  PdfVectorObject,
  | "height"
  | "originalHeight"
  | "originalWidth"
  | "originalX"
  | "originalY"
  | "width"
  | "x"
  | "y"
>;

/** 0.001pt is far below a device pixel and keeps long `d` strings short. */
const PATH_PRECISION = 1000;

const roundPathCoordinate = (value: number): number =>
  Math.round(value * PATH_PRECISION) / PATH_PRECISION;

const mapCommandPoint = (
  point: Point,
  box: PathBox,
  crop: CropBox,
  sourceRotate: PageRotation,
  pad: number
): Point => {
  const displayed = userPointToDisplayed(point, crop, sourceRotate);
  const sx = vectorAxisScale(box.originalWidth, box.width);
  const sy = vectorAxisScale(box.originalHeight, box.height);
  return {
    x: roundPathCoordinate((displayed.x - box.originalX) * sx + pad),
    y: roundPathCoordinate((displayed.y - box.originalY) * sy + pad),
  };
};

const commandsToSvgPath = (
  commands: readonly PdfPathCommand[],
  box: PathBox,
  crop: CropBox,
  sourceRotate: PageRotation,
  pad: number
): string => {
  const parts: string[] = [];
  for (const command of commands) {
    if (command.type === "moveTo") {
      const point = mapCommandPoint(command, box, crop, sourceRotate, pad);
      parts.push(`M ${point.x} ${point.y}`);
      continue;
    }
    if (command.type === "lineTo") {
      const point = mapCommandPoint(command, box, crop, sourceRotate, pad);
      parts.push(`L ${point.x} ${point.y}`);
      continue;
    }
    if (command.type === "curveTo") {
      const c1 = mapCommandPoint(
        { x: command.x1, y: command.y1 },
        box,
        crop,
        sourceRotate,
        pad
      );
      const c2 = mapCommandPoint(
        { x: command.x2, y: command.y2 },
        box,
        crop,
        sourceRotate,
        pad
      );
      const end = mapCommandPoint(
        { x: command.x3, y: command.y3 },
        box,
        crop,
        sourceRotate,
        pad
      );
      parts.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`);
      continue;
    }
    if (command.type === "quadraticCurveTo") {
      const control = mapCommandPoint(
        { x: command.x1, y: command.y1 },
        box,
        crop,
        sourceRotate,
        pad
      );
      const end = mapCommandPoint(
        { x: command.x, y: command.y },
        box,
        crop,
        sourceRotate,
        pad
      );
      parts.push(`Q ${control.x} ${control.y} ${end.x} ${end.y}`);
      continue;
    }
    parts.push("Z");
  }
  return parts.join(" ");
};

/** Covers and previews share one command list with different boxes. */
const MAX_PATHS_PER_COMMANDS = 8;

const svgPathCache = new WeakMap<
  readonly PdfPathCommand[],
  Map<string, string>
>();

/** Command lists are immutable, so a path string is reused until geometry changes. */
const cachedSvgPath = (
  commands: readonly PdfPathCommand[],
  box: PathBox,
  crop: CropBox,
  sourceRotate: PageRotation,
  pad: number
): string => {
  const key = [
    box.x,
    box.y,
    box.width,
    box.height,
    box.originalX,
    box.originalY,
    box.originalWidth,
    box.originalHeight,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    sourceRotate,
    pad,
  ].join(",");
  let paths = svgPathCache.get(commands);
  if (!paths) {
    paths = new Map();
    svgPathCache.set(commands, paths);
  }
  const cached = paths.get(key);
  if (cached !== undefined) {
    return cached;
  }
  if (paths.size >= MAX_PATHS_PER_COMMANDS) {
    paths.clear();
  }
  const d = commandsToSvgPath(commands, box, crop, sourceRotate, pad);
  paths.set(key, d);
  return d;
};

const strokeLinecap = (
  lineCap: number | undefined
): "butt" | "round" | "square" => {
  if (lineCap === 1) {
    return "round";
  }
  if (lineCap === 2) {
    return "square";
  }
  return "butt";
};

const strokeLinejoin = (
  lineJoin: number | undefined
): "miter" | "round" | "bevel" => {
  if (lineJoin === 1) {
    return "round";
  }
  if (lineJoin === 2) {
    return "bevel";
  }
  return "miter";
};

const PdfVectorPathSvg = ({
  box,
  commands,
  crop,
  fill,
  fillOpacity,
  lineCap,
  lineJoin,
  sourceRotate,
  stroke,
  strokeOpacity,
  strokeWidth,
  zoom,
}: {
  box: PathBox & { rotation: number };
  commands: readonly PdfPathCommand[];
  crop: CropBox;
  fill: string | null;
  fillOpacity?: number;
  lineCap: number;
  lineJoin: number;
  sourceRotate: PageRotation;
  stroke: string | null;
  strokeOpacity?: number;
  strokeWidth: number;
  zoom: number;
}) => {
  const pad = pdfVectorStrokePad(strokeWidth > 0 ? strokeWidth : undefined);
  const paddedWidth = box.width + pad * 2;
  const paddedHeight = box.height + pad * 2;
  const d = cachedSvgPath(commands, box, crop, sourceRotate, pad);
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-visible"
      height={paddedHeight * zoom}
      viewBox={`0 0 ${Math.max(paddedWidth, 1e-3)} ${Math.max(paddedHeight, 1e-3)}`}
      width={paddedWidth * zoom}
    >
      <path
        d={d}
        fill={fill ?? "none"}
        fillOpacity={fillOpacity}
        stroke={stroke ?? "none"}
        strokeOpacity={strokeOpacity}
        strokeLinecap={strokeLinecap(lineCap)}
        strokeLinejoin={strokeLinejoin(lineJoin)}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

/** Smallest on-screen thickness a selected vector can be dragged by. */
const PDF_VECTOR_GRAB_MIN_PX = 10;

/**
 * Widens a selected vector's drag target to a grabbable size: a straight
 * line's box is a hair thick and would otherwise give the pointer nothing
 * to press.
 */
const pdfVectorGrabInset = (
  object: { height: number; width: number },
  zoom: number
) => {
  const padX = Math.max(0, (PDF_VECTOR_GRAB_MIN_PX - object.width * zoom) / 2);
  const padY = Math.max(0, (PDF_VECTOR_GRAB_MIN_PX - object.height * zoom) / 2);
  return { bottom: -padY, left: -padX, right: -padX, top: -padY };
};

const PdfVectorPreview = ({
  crop,
  nested,
  object,
  sourceRotate,
  zoom,
}: {
  crop: CropBox;
  nested?: boolean;
  object: PdfVectorObject;
  sourceRotate: PageRotation;
  zoom: number;
}) => {
  const strokeWidth = object.stroke
    ? object.stroke.width * vectorStrokeScale(object)
    : undefined;
  const pad = pdfVectorStrokePad(strokeWidth);
  const svg = (
    <PdfVectorPathSvg
      box={object}
      commands={object.commands}
      crop={crop}
      fill={object.fill?.color ?? null}
      fillOpacity={object.fill?.opacity}
      lineCap={object.stroke?.lineCap ?? 0}
      lineJoin={object.stroke?.lineJoin ?? 0}
      sourceRotate={sourceRotate}
      stroke={object.stroke?.color ?? null}
      strokeOpacity={object.stroke?.opacity}
      strokeWidth={strokeWidth ?? 0}
      zoom={zoom}
    />
  );
  if (!nested) {
    return svg;
  }
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        height: (object.height + pad * 2) * zoom,
        left: -pad * zoom,
        top: -pad * zoom,
        width: (object.width + pad * 2) * zoom,
      }}
    >
      {svg}
    </div>
  );
};

/** Repaints a vector's original path to hide it; text ink passes its own style. */
export const PdfVectorCover = ({
  crop,
  object,
  sourceRotate,
  style = pdfVectorCoverPathStyle(object),
  zoom,
}: {
  crop: CropBox;
  object: PdfVectorObject;
  sourceRotate: PageRotation;
  style?: PdfVectorCoverPathStyle;
  zoom: number;
}) => {
  const geometry = {
    ...pdfVectorCoverGeometry(object),
    rotation: object.originalRotation,
  };
  const pad = pdfVectorStrokePad(
    style.strokeWidth > 0 ? style.strokeWidth : undefined
  );
  const wrapper = {
    height: geometry.height + pad * 2,
    rotation: geometry.rotation,
    width: geometry.width + pad * 2,
    x: geometry.x - pad,
    y: geometry.y - pad,
  };
  return (
    <div
      className="pointer-events-none absolute origin-center"
      style={objectWrapperStyle(wrapper, zoom)}
    >
      <PdfVectorPathSvg
        box={geometry}
        commands={object.commands}
        crop={crop}
        fill={style.fill}
        lineCap={style.lineCap}
        lineJoin={style.lineJoin}
        sourceRotate={sourceRotate}
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        zoom={zoom}
      />
    </div>
  );
};

const PdfVectorLayerView = ({
  boundsRef,
  crop,
  gestureRef,
  hoveredId,
  nodeRefs,
  objects,
  onTransformStart,
  rootRef,
  selectedId,
  sourceRotate,
  toPage,
  transformingId,
  zoom,
}: {
  boundsRef: RefBox<PageBounds | null>;
  crop: CropBox;
  gestureRef: RefBox<Gesture | null>;
  hoveredId: string | null;
  nodeRefs: RefBox<Map<string, HTMLDivElement>>;
  objects: readonly PdfVectorObject[];
  onTransformStart: (objectId: string) => void;
  rootRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  sourceRotate: PageRotation;
  toPage: (event: { clientX: number; clientY: number }) => Point;
  transformingId: string | null;
  zoom: number;
}) => (
  <>
    {objects.map((object) =>
      shouldPaintPdfVectorCover(object, transformingId) ? (
        <PdfVectorCover
          crop={crop}
          key={`cover-${object.id}`}
          object={object}
          sourceRotate={sourceRotate}
          zoom={zoom}
        />
      ) : null
    )}
    {objects.map((object) => {
      if (object.id === selectedId) {
        return null;
      }
      if (!shouldPaintPdfVectorPreview(object, transformingId)) {
        return null;
      }
      return (
        <div
          className="pointer-events-none absolute origin-center"
          key={`preview-${object.id}`}
          style={objectWrapperStyle(pdfVectorPreviewBox(object), zoom)}
        >
          <PdfVectorPreview
            crop={crop}
            object={object}
            sourceRotate={sourceRotate}
            zoom={zoom}
          />
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
              editorStore.selectPdfVector(object.id);
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
            <div
              aria-hidden
              className="absolute"
              style={pdfVectorGrabInset(object, zoom)}
            />
            {shouldPaintPdfVectorPreview(object, transformingId) ? (
              <PdfVectorPreview
                crop={crop}
                nested
                object={object}
                sourceRotate={sourceRotate}
                zoom={zoom}
              />
            ) : null}
            <SelectionBox
              box={object}
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
                  origin: object,
                };
              }}
              onRotatePointerDown={(event) => {
                event.stopPropagation();
                boundsRef.current = snapshotBounds(
                  requireOverlayRoot(rootRef.current)
                );
                rootRef.current?.setPointerCapture(event.pointerId);
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
export const PdfVectorLayer = memo(PdfVectorLayerView);
