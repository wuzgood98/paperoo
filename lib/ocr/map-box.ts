import type { Rect } from "@/lib/editor/types";
import type { OcrImageBbox } from "@/lib/ocr/types";

export const ocrImageBoxToDisplayed = (
  bbox: OcrImageBbox,
  scale: number
): Rect => {
  const left = Math.min(bbox.x0, bbox.x1);
  const top = Math.min(bbox.y0, bbox.y1);
  return {
    height: Math.abs(bbox.y1 - bbox.y0) / scale,
    width: Math.abs(bbox.x1 - bbox.x0) / scale,
    x: left / scale,
    y: top / scale,
  };
};
