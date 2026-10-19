import { ShapeSvg } from "@/components/editor/objects/shape-svg";
import type { OverlayDraft } from "@/components/editor/overlay-gestures";
import { isRisingDrag, SIGNATURE_PLACE_SIZE } from "@/lib/editor/object-utils";
import type {
  DrawStyleDefaults,
  EditorTool,
  Point,
  ShapeStyleDefaults,
} from "@/lib/editor/types";

/** Same geometry as the committed shape, so releasing the mouse changes nothing. */
const ShapeDraft = ({
  draft,
  shapeStyle,
  zoom,
}: {
  draft: { end: Point; start: Point };
  shapeStyle: ShapeStyleDefaults;
  zoom: number;
}) => {
  const width = Math.abs(draft.end.x - draft.start.x);
  const height = Math.abs(draft.end.y - draft.start.y);
  return (
    <ShapeSvg
      className="pointer-events-none absolute"
      dashed={shapeStyle.dashed}
      fill={shapeStyle.fill}
      flip={isRisingDrag(draft.start, draft.end)}
      height={height}
      shape={shapeStyle.shape}
      stroke={shapeStyle.stroke}
      strokeWidth={shapeStyle.strokeWidth}
      style={{
        height: height * zoom,
        left: Math.min(draft.start.x, draft.end.x) * zoom,
        top: Math.min(draft.start.y, draft.end.y) * zoom,
        width: width * zoom,
      }}
      width={width}
      zoom={zoom}
    />
  );
};

export const OverlayPreviews = ({
  draft,
  drawStyle,
  highlightColor,
  pendingScaled,
  placingSignature,
  previewPoint,
  redactionFill,
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
  redactionFill: string;
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
    {draft?.kind === "rect" && tool === "redact" ? (
      <div
        className="border-destructive pointer-events-none absolute border border-dashed"
        style={{
          backgroundColor: `color-mix(in srgb, ${redactionFill} 50%, transparent)`,
          height: Math.abs(draft.end.y - draft.start.y) * zoom,
          left: Math.min(draft.start.x, draft.end.x) * zoom,
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
