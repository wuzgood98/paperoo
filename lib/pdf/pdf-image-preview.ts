import { pageToCss } from "@/lib/editor/coordinates";
import { isPdfImageDirty, pdfImageAssetId } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorDocument, PdfImageObject } from "@/lib/editor/types";
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

export interface PdfJsObjectStore {
  get: (
    id: string,
    callback?: (data: PdfJsImageData) => void
  ) => PdfJsImageData | undefined;
  has: (id: string) => boolean;
}

const RGBA_KIND = 3;
const RGB_KIND = 2;
const IMAGE_RESOLVE_MS = 4000;

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

const hasImagePixels = (value: PdfJsImageData | null): boolean =>
  value !== null && (value.bitmap !== undefined || value.data !== undefined);

const readResolved = (
  store: PdfJsObjectStore,
  id: string
): PdfJsImageData | null => {
  if (!store.has(id)) {
    return null;
  }
  try {
    return parseImageData(store.get(id));
  } catch {
    return null;
  }
};

export const resolvePdfJsImageFromStores = (
  pageStore: PdfJsObjectStore,
  commonStore: PdfJsObjectStore,
  sourceId: string
): Promise<PdfJsImageData | null> => {
  const ready =
    readResolved(pageStore, sourceId) ?? readResolved(commonStore, sourceId);
  if (hasImagePixels(ready)) {
    return Promise.resolve(ready);
  }

  // oxlint-disable-next-line promise/avoid-new -- PDFObjects.get only notifies through a callback
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PdfJsImageData | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, IMAGE_RESOLVE_MS);

    const onData = (data: PdfJsImageData): void => {
      const parsed = parseImageData(data);
      if (!hasImagePixels(parsed)) {
        return;
      }
      clearTimeout(timer);
      finish(parsed);
    };

    pageStore.get(sourceId, onData);
    commonStore.get(sourceId, onData);
  });
};

const resolvePageImage = (
  page: PDFPageProxy,
  sourceId: string
): Promise<PdfJsImageData | null> => {
  // SAFETY: PDF.js PDFObjects.get returns the decoded image record after
  // getOperatorList; parseImageData checks width/height before use.
  const pageStore = page.objs as PdfJsObjectStore;
  // SAFETY: commonObjs uses the same PDFObjects.get contract as page.objs.
  const commonStore = page.commonObjs as PdfJsObjectStore;
  return resolvePdfJsImageFromStores(pageStore, commonStore, sourceId);
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

export const pageBoxToCanvasCrop = (
  box: { height: number; width: number; x: number; y: number },
  zoom: number,
  canvas: {
    cssHeight: number;
    cssWidth: number;
    height: number;
    width: number;
  }
): { height: number; width: number; x: number; y: number } | null => {
  if (canvas.cssWidth < 1 || canvas.cssHeight < 1) {
    return null;
  }
  const scaleX = canvas.width / canvas.cssWidth;
  const scaleY = canvas.height / canvas.cssHeight;
  const left = pageToCss(box.x, zoom) * scaleX;
  const top = pageToCss(box.y, zoom) * scaleY;
  const right = left + pageToCss(box.width, zoom) * scaleX;
  const bottom = top + pageToCss(box.height, zoom) * scaleY;
  const cropLeft = Math.max(0, Math.min(canvas.width, left));
  const cropTop = Math.max(0, Math.min(canvas.height, top));
  const cropRight = Math.max(cropLeft, Math.min(canvas.width, right));
  const cropBottom = Math.max(cropTop, Math.min(canvas.height, bottom));
  const width = Math.round(cropRight - cropLeft);
  const height = Math.round(cropBottom - cropTop);
  if (width < 1 || height < 1) {
    return null;
  }
  return {
    height,
    width,
    x: Math.round(cropLeft),
    y: Math.round(cropTop),
  };
};

const pngFromDataUrl = (dataUrl: string): Uint8Array | null => {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    return null;
  }
  const binary = atob(dataUrl.slice(comma + 1));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
};

const pageCanvasFromOverlay = (
  overlayRoot: HTMLElement | null
): HTMLCanvasElement | null => {
  const sibling = overlayRoot?.parentElement?.previousElementSibling;
  return sibling instanceof HTMLCanvasElement ? sibling : null;
};

export const capturePdfImagePreviewFromCanvas = (
  object: PdfImageObject,
  overlayRoot: HTMLElement | null,
  zoom: number
): string | null => {
  if (pdfImageAssetId(object)) {
    return pdfImageAssetId(object);
  }
  const canvas = pageCanvasFromOverlay(overlayRoot);
  if (!canvas) {
    return null;
  }
  const crop = pageBoxToCanvasCrop(object, zoom, {
    cssHeight: canvas.clientHeight,
    cssWidth: canvas.clientWidth,
    height: canvas.height,
    width: canvas.width,
  });
  if (!crop) {
    return null;
  }
  const copy = document.createElement("canvas");
  copy.width = crop.width;
  copy.height = crop.height;
  const context = copy.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(
    canvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );
  const bytes = pngFromDataUrl(copy.toDataURL("image/png"));
  if (!bytes) {
    return null;
  }
  const asset = editorStore.addAsset(bytes, "image/png", { provisional: true });
  editorStore.setPdfImagePreview(object.id, asset.id);
  return asset.id;
};

/** id → image per document snapshot, so many lookups share one walk. */
const imagesByDocument = new WeakMap<
  EditorDocument,
  Map<string, PdfImageObject>
>();

const livePdfImage = (object: PdfImageObject): PdfImageObject => {
  const { document } = editorStore.getState();
  let images = imagesByDocument.get(document);
  if (!images) {
    images = new Map();
    for (const page of document.pages) {
      for (const image of page.pdfImageObjects) {
        images.set(image.id, image);
      }
    }
    imagesByDocument.set(document, images);
  }
  return images.get(object.id) ?? object;
};

export const ensurePdfImagePreview = async (
  object: PdfImageObject,
  pageSourceIndex: number
): Promise<string | null> => {
  const live = livePdfImage(object);
  if (live.replacementAssetId) {
    return live.replacementAssetId;
  }
  if (
    live.previewAssetId &&
    !editorStore.isProvisionalAsset(live.previewAssetId)
  ) {
    return live.previewAssetId;
  }

  const page = await pdfSession.getPage(pageSourceIndex);
  if (!page) {
    return null;
  }
  const pending = resolvePageImage(page, live.sourceId);
  await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  const raw = await pending;
  if (!raw) {
    return null;
  }
  const bytes = await encodePdfJsImage(raw);
  if (!bytes) {
    return null;
  }
  const asset = editorStore.addAsset(bytes, "image/png");
  editorStore.setPdfImagePreview(live.id, asset.id);
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
