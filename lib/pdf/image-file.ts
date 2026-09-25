import type { ImageMimeType } from "@/lib/editor/types";

const SUPPORTED = new Set(["image/png", "image/jpeg", "image/webp"]);

export const readImageFile = async (
  file: File
): Promise<{
  bytes: Uint8Array;
  height: number;
  mimeType: ImageMimeType;
  width: number;
}> => {
  if (!SUPPORTED.has(file.type)) {
    throw new Error("Use a PNG, JPEG, or WebP image.");
  }

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  const { width } = bitmap;
  const { height } = bitmap;

  if (file.type === "image/webp") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("Could not convert this WebP image.");
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    // oxlint-disable-next-line promise/avoid-new -- canvas.toBlob only accepts a callback
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value);
          return;
        }
        reject(new Error("Could not encode the image as PNG."));
      }, "image/png");
    });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      height,
      mimeType: "image/png",
      width,
    };
  }

  bitmap.close();
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    throw new Error("Use a PNG, JPEG, or WebP image.");
  }
  return {
    bytes: sourceBytes,
    height,
    mimeType: file.type,
    width,
  };
};
