import type { OverlayDraft } from "@/components/editor/overlay-gestures";
import { isRisingDrag, SIGNATURE_PLACE_SIZE } from "@/lib/editor/object-utils";
import type {
  DrawStyleDefaults,
  EditorTool,
  Point,
  ShapeStyleDefaults,
} from "@/lib/editor/types";

/** Mirrors the committed shape in `objects/object-view.tsx`. */
const ShapeDraft = ({
  draft,
  shapeStyle,
  zoom,
}: {
  draft: { end: Point; start: Point };
  shapeStyle: ShapeStyleDefaults;
  zoom: number;
}) => {
  const width = Math.abs(draft.end.x - draft.start.x) * zoom;
  const height = Math.abs(draft.end.y - draft.start.y) * zoom;
  const strokeWidth = shapeStyle.strokeWidth * zoom;
  const fill = shapeStyle.fill ?? "none";
  const rising = isRisingDrag(draft.start, draft.end);
  return (
    <svg
      className="pointer-events-none absolute overflow-hidden"
      style={{
        height,
        left: Math.min(draft.start.x, draft.end.x) * zoom,
        top: Math.min(draft.start.y, draft.end.y) * zoom,
        width,
      }}
    >
      {shapeStyle.shape === "line" ? (
        <line
          stroke={shapeStyle.stroke}
          strokeWidth={strokeWidth}
          x1={0}
          x2={width}
          y1={rising ? height : 0}
          y2={rising ? 0 : height}
        />
      ) : null}
      {shapeStyle.shape === "circle" ? (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          fill={fill}
          rx={width / 2}
          ry={height / 2}
          stroke={shapeStyle.stroke}
          strokeWidth={strokeWidth}
        />
      ) : null}
      {shapeStyle.shape === "rect" ? (
        <rect
          fill={fill}
          height={Math.max(0, height - strokeWidth)}
          stroke={shapeStyle.stroke}
          strokeWidth={strokeWidth}
          width={Math.max(0, width - strokeWidth)}
          x={strokeWidth / 2}
          y={strokeWidth / 2}
        />
      ) : null}
    </svg>
  );
};

export const OverlayPreviews = ({
  draft,
  drawStyle,
  highlightColor,
  pendingScaled,
  placingSignature,
  previewPoint,
  shapeStyle,
  tool,
  zoom,
}: {
  draft: OverlayDraft | null;
  drawStyle: DrawStyleDefaults;
  highlightColor: string;
  pendingScaled: Point[] | null;
  placingSignature: boolean;
  previewPoint: Point | null;
  shapeStyle: ShapeStyleDefaults;
  tool: EditorTool;
  zoom: number;
}) => (
  <>
    {draft?.kind === "draw" ? (
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <path
          d={draft.points
            .map(
              (point, index) =>
                `${index === 0 ? "M" : "L"}${point.x * zoom} ${point.y * zoom}`
            )
            .join(" ")}
          fill="none"
          stroke={drawStyle.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={drawStyle.strokeWidth * zoom}
        />
      </svg>
    ) : null}
    {draft?.kind === "rect" && tool === "highlight" ? (
      <div
        className="pointer-events-none absolute"
        style={{
          backgroundColor: highlightColor,
          height: Math.abs(draft.end.y - draft.start.y) * zoom,
          left: Math.min(draft.start.x, draft.end.x) * zoom,
          opacity: 0.4,
          top: Math.min(draft.start.y, draft.end.y) * zoom,
          width: Math.abs(draft.end.x - draft.start.x) * zoom,
        }}
      />
    ) : null}
    {draft?.kind === "rect" && tool === "shape" ? (
      <ShapeDraft draft={draft} shapeStyle={shapeStyle} zoom={zoom} />
    ) : null}
    {placingSignature && pendingScaled && previewPoint ? (
      <svg
        className="text-foreground pointer-events-none absolute overflow-visible"
        style={{
          height: SIGNATURE_PLACE_SIZE.height * zoom,
          left: previewPoint.x * zoom,
          top: previewPoint.y * zoom,
          width: SIGNATURE_PLACE_SIZE.width * zoom,
        }}
        viewBox={`0 0 ${SIGNATURE_PLACE_SIZE.width} ${SIGNATURE_PLACE_SIZE.height}`}
      >
        <path
          d={pendingScaled
            .map(
              (point, index) =>
                `${index === 0 ? "M" : "L"}${point.x} ${point.y}`
            )
            .join(" ")}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
      </svg>
    ) : null}
  </>
);
