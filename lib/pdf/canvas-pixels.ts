import type { EditorPage, Rect } from "@/lib/editor/types";

export interface ImagePixelSource {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

const channelToHex = (value: number): string => {
  const clamped = Math.round(Math.min(255, Math.max(0, value)));
  return clamped.toString(16).padStart(2, "0");
};

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;

/** RGB at a pixel, or null outside the image. */
export const readPixel = (
  source: ImagePixelSource,
  x: number,
  y: number
): [number, number, number] | null => {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) {
    return null;
  }
  const index = (y * source.width + x) * 4;
  const r = source.data[index] ?? 0;
  const g = source.data[index + 1] ?? 0;
  const b = source.data[index + 2] ?? 0;
  return [r, g, b];
};

export const displayedRectToCanvasPixels = (
  rect: Rect,
  page: Pick<EditorPage, "width">,
  canvas: HTMLCanvasElement,
  zoom: number
): Rect => {
  const ratio = canvas.width / Math.max(1, page.width * zoom);
  return {
    height: Math.max(1, Math.ceil(rect.height * zoom * ratio)),
    width: Math.max(1, Math.ceil(rect.width * zoom * ratio)),
    x: Math.floor(rect.x * zoom * ratio),
    y: Math.floor(rect.y * zoom * ratio),
  };
};
