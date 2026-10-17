import type { CSSProperties } from "react";

import { insetShapePathBox } from "@/lib/editor/object-utils";
import type { ShapeKind } from "@/lib/editor/types";

/**
 * A shape given in page units and drawn at `zoom`. Shared by the committed
 * object and the drag preview so both match the export.
 *
 * Rects and circles keep their stroke inside the box. A line runs corner to
 * corner, so its stroke edges and butt caps pass the box and the SVG must not
 * clip. Coordinates are CSS pixels with no viewBox, because a straight line's
 * flat axis is 0 and a zero-size viewBox would stop the SVG from rendering.
 * With no viewBox, the 1px minimum size never shifts or scales the shape.
 */
export const ShapeSvg = ({
  className,
  fill,
  flip = false,
  height,
  shape,
  stroke,
  strokeWidth,
  style,
  width,
  zoom,
}: {
  className?: string;
  fill: string | null;
  flip?: boolean;
  height: number;
  shape: ShapeKind;
  stroke: string;
  strokeWidth: number;
  style?: CSSProperties;
  width: number;
  zoom: number;
}) => {
  const path = insetShapePathBox({ height, width }, strokeWidth);
  return (
    <svg
      aria-hidden="true"
      // Browsers skip a zero-size <svg>, so a flat line still needs 1px to paint.
      className={`min-h-px min-w-px overflow-visible ${className ?? ""}`}
      style={style}
    >
      {shape === "line" ? (
        <line
          stroke={stroke}
          strokeWidth={strokeWidth * zoom}
          x1={0}
          x2={width * zoom}
          y1={flip ? height * zoom : 0}
          y2={flip ? 0 : height * zoom}
        />
      ) : null}
      {shape === "circle" ? (
        <ellipse
          cx={(width / 2) * zoom}
          cy={(height / 2) * zoom}
          fill={fill ?? "none"}
          rx={(path.width / 2) * zoom}
          ry={(path.height / 2) * zoom}
          stroke={stroke}
          strokeWidth={strokeWidth * zoom}
        />
      ) : null}
      {shape === "rect" ? (
        <rect
          fill={fill ?? "none"}
          height={path.height * zoom}
          stroke={stroke}
          strokeWidth={strokeWidth * zoom}
          width={path.width * zoom}
          x={path.x * zoom}
          y={path.y * zoom}
        />
      ) : null}
    </svg>
  );
};
