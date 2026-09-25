import type { OverlayDraft } from "@/components/editor/overlay-gestures";
import { SIGNATURE_PLACE_SIZE } from "@/lib/editor/object-utils";
import type {
  DrawStyleDefaults,
  EditorTool,
  Point,
  ShapeStyleDefaults,
} from "@/lib/editor/types";

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
    {draft?.kind === "rect" ? (
      <div
        className="pointer-events-none absolute"
        style={{
          backgroundColor:
            tool === "highlight" ? highlightColor : "transparent",
          border:
            tool === "shape" ? `2px solid ${shapeStyle.stroke}` : undefined,
          height: Math.abs(draft.end.y - draft.start.y) * zoom,
          left: Math.min(draft.start.x, draft.end.x) * zoom,
          opacity: tool === "highlight" ? 0.4 : 1,
          top: Math.min(draft.start.y, draft.end.y) * zoom,
          width: Math.abs(draft.end.x - draft.start.x) * zoom,
        }}
      />
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
