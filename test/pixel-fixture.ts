import type { ImagePixelSource } from "@/lib/pdf/canvas-pixels";

export const fillRect = (
  source: ImagePixelSource,
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): void => {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const index = (row * source.width + col) * 4;
      source.data[index] = r;
      source.data[index + 1] = g;
      source.data[index + 2] = b;
      source.data[index + 3] = 255;
    }
  }
};

export const blankImage = (
  width: number,
  height: number
): ImagePixelSource => ({
  data: new Uint8ClampedArray(width * height * 4).fill(255),
  height,
  width,
});
