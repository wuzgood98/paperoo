import type { ImageCodec } from "@/lib/pdf/image-redaction";

/** JPEG quality for re-encoded images: matches flattened pages. */
const JPEG_QUALITY = 0.92;

const context2d = (
  canvas: OffscreenCanvas
): OffscreenCanvasRenderingContext2D => {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No 2D canvas in this worker.");
  }
  return context;
};

/**
 * JPEG through the worker's own image decoder and OffscreenCanvas, or
 * undefined where the worker has neither (then such pages flatten).
 */
export const workerImageCodec = (): ImageCodec | undefined => {
  if (!("OffscreenCanvas" in globalThis && "createImageBitmap" in globalThis)) {
    return undefined;
  }
  return {
    decodeJpeg: async (bytes) => {
      try {
        // PDF readers ignore EXIF orientation and colour tags; so does this.
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" }),
          {
            colorSpaceConversion: "none",
            imageOrientation: "none",
            premultiplyAlpha: "none",
          }
        );
        const { height, width } = bitmap;
        const context = context2d(new OffscreenCanvas(width, height));
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          data: context.getImageData(0, 0, width, height).data,
          height,
          width,
        };
      } catch {
        return null;
      }
    },
    encodeJpeg: async (rgba, width, height) => {
      const canvas = new OffscreenCanvas(width, height);
      context2d(canvas).putImageData(
        new ImageData(Uint8ClampedArray.from(rgba), width, height),
        0,
        0
      );
      const blob = await canvas.convertToBlob({
        quality: JPEG_QUALITY,
        type: "image/jpeg",
      });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
};
