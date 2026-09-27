import { isPdfImageDirty } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { PdfImageObject } from "@/lib/editor/types";
import { AnnotationMode } from "@/lib/pdf/pdfjs";
import type { PDFPageProxy } from "@/lib/pdf/pdfjs";
import { pdfSession } from "@/lib/pdf/session";

interface PdfJsImageData {
  bitmap?: ImageBitmap;
  data?: ArrayLike<number>;
  height?: number;
  kind?: number;
  width?: number;
}

interface PdfJsObjectStore {
  get: (
    id: string,
    callback?: (data: PdfJsImageData) => void
  ) => PdfJsImageData | undefined;
  has: (id: string) => boolean;
}

const RGBA_KIND = 3;
const RGB_KIND = 2;

const parseImageData = (
  value: PdfJsImageData | undefined
): PdfJsImageData | null => {
  if (!value) {
    return null;
  }
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return {
    bitmap: value.bitmap,
    data: value.data,
    height,
    kind: Number.isFinite(value.kind) ? Number(value.kind) : undefined,
    width,
  };
};

const IMAGE_RESOLVE_MS = 4000;

const waitForObj = (
  store: PdfJsObjectStore,
  id: string
): Promise<PdfJsImageData | null> =>
  // oxlint-disable-next-line promise/avoid-new -- PDFObjects.get only notifies through a callback
  new Promise((resolve) => {
    let settled = false;
    const finish = (value: PdfJsImageData | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    if (store.has(id)) {
      try {
        finish(parseImageData(store.get(id)));
      } catch {
        finish(null);
      }
      return;
    }

    const timer = setTimeout(() => {
      finish(null);
    }, IMAGE_RESOLVE_MS);
    store.get(id, (data) => {
      clearTimeout(timer);
      finish(parseImageData(data));
    });
  });

const resolvePageImage = async (
  page: PDFPageProxy,
  sourceId: string
): Promise<PdfJsImageData | null> => {
  // SAFETY: PDF.js PDFObjects.get returns the decoded image record after
  // getOperatorList; parseImageData checks width/height before use.
  const pageStore = page.objs as PdfJsObjectStore;
  // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
  const commonStore = page.commonObjs as PdfJsObjectStore;
  const preferred = sourceId.startsWith("g_") ? commonStore : pageStore;
  const fallback = sourceId.startsWith("g_") ? pageStore : commonStore;
  if (fallback.has(sourceId) && !preferred.has(sourceId)) {
    return waitForObj(fallback, sourceId);
  }
  return (
    (await waitForObj(preferred, sourceId)) ?? waitForObj(fallback, sourceId)
  );
};

const toRgba = (
  data: ArrayLike<number>,
  width: number,
  height: number,
  kind: number | undefined
): Uint8ClampedArray => {
  if (kind === RGBA_KIND || data.length === width * height * 4) {
    return data instanceof Uint8ClampedArray
      ? data
      : new Uint8ClampedArray(data);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (kind === RGB_KIND || data.length === width * height * 3) {
    for (
      let index = 0, pixel = 0;
      index < data.length;
      index += 3, pixel += 4
    ) {
      rgba[pixel] = data[index] ?? 0;
      rgba[pixel + 1] = data[index + 1] ?? 0;
      rgba[pixel + 2] = data[index + 2] ?? 0;
      rgba[pixel + 3] = 255;
    }
    return rgba;
  }
  for (let index = 0; index < width * height; index += 1) {
    const value = data[index] ?? 0;
    const pixel = index * 4;
    rgba[pixel] = value;
    rgba[pixel + 1] = value;
    rgba[pixel + 2] = value;
    rgba[pixel + 3] = 255;
  }
  return rgba;
};

const toImageData = (
  data: ArrayLike<number>,
  width: number,
  height: number,
  kind: number | undefined
): ImageData => {
  const rgba = toRgba(data, width, height, kind);
  const copy = new Uint8ClampedArray(new ArrayBuffer(rgba.byteLength));
  copy.set(rgba);
  return new ImageData(copy, width, height);
};

const canvasToPng = async (
  canvas: OffscreenCanvas | HTMLCanvasElement
): Promise<Uint8Array | null> => {
  if ("convertToBlob" in canvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  // oxlint-disable-next-line promise/avoid-new -- HTMLCanvasElement.toBlob is callback-only
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) {
    return null;
  }
  return new Uint8Array(await blob.arrayBuffer());
};

const encodePdfJsImage = async (
  image: PdfJsImageData
): Promise<Uint8Array | null> => {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  if (width < 1 || height < 1) {
    return null;
  }

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    if (image.bitmap) {
      context.drawImage(image.bitmap, 0, 0);
    } else if (image.data) {
      context.putImageData(
        toImageData(image.data, width, height, image.kind),
        0,
        0
      );
    } else {
      return null;
    }
    return await canvasToPng(canvas);
  }

  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0);
  } else if (image.data) {
    context.putImageData(
      toImageData(image.data, width, height, image.kind),
      0,
      0
    );
  } else {
    return null;
  }
  return await canvasToPng(canvas);
};

export const ensurePdfImagePreview = async (
  object: PdfImageObject,
  pageSourceIndex: number
): Promise<string | null> => {
  if (object.replacementAssetId) {
    return object.replacementAssetId;
  }
  if (object.previewAssetId) {
    return object.previewAssetId;
  }

  const page = await pdfSession.getPage(pageSourceIndex);
  if (!page) {
    return null;
  }
  await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  const raw = await resolvePageImage(page, object.sourceId);
  if (!raw) {
    return null;
  }
  const bytes = await encodePdfJsImage(raw);
  if (!bytes) {
    return null;
  }
  const asset = editorStore.addAsset(bytes, "image/png");
  editorStore.setPdfImagePreview(object.id, asset.id);
  return asset.id;
};

export const ensureDirtyPdfImageAssets = async (): Promise<void> => {
  const { document } = editorStore.getState();
  const pending: Promise<string | null>[] = [];
  for (const page of document.pages) {
    for (const object of page.pdfImageObjects) {
      if (
        isPdfImageDirty(object) &&
        !object.deleted &&
        !object.replacementAssetId
      ) {
        pending.push(ensurePdfImagePreview(object, page.sourceIndex));
      }
    }
  }
  await Promise.all(pending);
};
