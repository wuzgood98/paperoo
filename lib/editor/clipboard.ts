import { createId } from "@/lib/editor/ids";
import { createTextObject, findPage } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorObject,
  EditorPage,
  ImageMimeType,
  Size,
  TextObject,
  TextStyleDefaults,
} from "@/lib/editor/types";
import { canvasTextWidth, wrapText } from "@/lib/fonts/measure-text";

/** Offset for a paste onto the page it was copied from, and for Duplicate. */
export const PASTE_OFFSET = 10;

/** Longest plain text pasted as a text box. */
export const MAX_PASTED_TEXT = 10_000;

/** Pasted images start at most this share of the page width. */
const PASTED_IMAGE_MAX_WIDTH_RATIO = 0.4;

/** Pasted text wraps at this share of the page width. */
const PASTED_TEXT_MAX_WIDTH_RATIO = 0.6;

/** Matches the text box's CSS `line-height` and the export. */
const TEXT_LINE_HEIGHT = 1.2;

/** Room past the widest line so canvas and DOM rounding never rewraps it. */
const TEXT_WIDTH_SLACK = 2;

/** Data type that marks clipboard contents written by this editor. */
export const CLIPBOARD_MARKER_TYPE = "application/x-paperoo";

interface ClipboardImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
}

/** Copied overlay objects. Held in memory: not part of the document or undo. */
export interface ClipboardEntry {
  id: string;
  images: ReadonlyMap<string, ClipboardImage>;
  objects: readonly EditorObject[];
  /** Pastes onto the source page so far; each one cascades further. */
  pasteCount: number;
  sourcePageId: string;
  /** The text boxes' content, as written to the system clipboard. */
  text: string;
}

let entry: ClipboardEntry | null = null;

export const clipboardEntry = (): ClipboardEntry | null => entry;

export const clearClipboard = (): void => {
  entry = null;
};

/** Selected overlay objects on the current page, in stacking order. */
export const selectedOverlayObjects = (): {
  objects: EditorObject[];
  page: EditorPage;
} | null => {
  const state = editorStore.getState();
  const page = findPage(state.document.pages, state.currentPageId);
  if (!page || state.selectedObjectIds.length === 0) {
    return null;
  }
  const ids = new Set(state.selectedObjectIds);
  const objects = page.objects.filter((object) => ids.has(object.id));
  return objects.length > 0 ? { objects, page } : null;
};

export const clipboardText = (objects: readonly EditorObject[]): string =>
  objects
    .flatMap((object) => (object.type === "text" ? [object.content] : []))
    .join("\n");

/** Copy the selected overlay objects; null when none are selected. */
export const copySelection = (): ClipboardEntry | null => {
  const selected = selectedOverlayObjects();
  if (!selected) {
    return null;
  }
  const images = new Map<string, ClipboardImage>();
  for (const object of selected.objects) {
    if (object.type !== "image") {
      continue;
    }
    // Assets are never mutated, so the bytes are shared, not copied.
    const asset = editorStore.getAsset(object.assetId);
    if (asset) {
      images.set(object.assetId, {
        bytes: asset.bytes,
        mimeType: asset.mimeType,
      });
    }
  }
  entry = {
    id: createId(),
    images,
    objects: structuredClone(selected.objects),
    pasteCount: 0,
    sourcePageId: selected.page.id,
    text: clipboardText(selected.objects),
  };
  return entry;
};

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(value, 0), Math.max(max, 0));

/**
 * Copies of `objects` with fresh ids, moved by `offset` and kept on the page.
 * A copy of recognized text is plain text: it loses its OCR word.
 */
export const prepareObjectsForPaste = (
  objects: readonly EditorObject[],
  page: Pick<EditorPage, "height" | "width">,
  offset: number
): EditorObject[] =>
  objects.map((object) => {
    const copy: EditorObject = {
      ...structuredClone(object),
      id: createId(),
      x: clamp(object.x + offset, page.width - object.width),
      y: clamp(object.y + offset, page.height - object.height),
    };
    if (copy.type === "text") {
      delete copy.ocrWordId;
    }
    return copy;
  });

/** Point to the entry's images, adding back any the document no longer has. */
export const resolveClipboardImages = (
  objects: readonly EditorObject[],
  images: ReadonlyMap<string, ClipboardImage>
): EditorObject[] => {
  const replaced = new Map<string, string>();
  return objects.map((object) => {
    if (object.type !== "image" || editorStore.getAsset(object.assetId)) {
      return object;
    }
    let assetId = replaced.get(object.assetId);
    if (!assetId) {
      const image = images.get(object.assetId);
      if (!image) {
        return object;
      }
      assetId = editorStore.addAsset(image.bytes, image.mimeType).id;
      replaced.set(object.assetId, assetId);
    }
    return { ...object, assetId };
  });
};

/** Paste the copied objects onto the current page; false when there is nothing to paste. */
export const pasteClipboard = (): boolean => {
  const state = editorStore.getState();
  const page = findPage(state.document.pages, state.currentPageId);
  if (!entry || !page) {
    return false;
  }
  // Onto the source page, each paste steps further; elsewhere, paste in place.
  let offset = 0;
  if (page.id === entry.sourcePageId) {
    entry.pasteCount += 1;
    offset = PASTE_OFFSET * entry.pasteCount;
  }
  const objects = resolveClipboardImages(
    prepareObjectsForPaste(entry.objects, page, offset),
    entry.images
  );
  editorStore.insertObjects(page.id, objects);
  return true;
};

/** Copy the selection in place, offset; the clipboard is left alone. */
export const duplicateSelection = (): boolean => {
  const selected = selectedOverlayObjects();
  if (!selected) {
    return false;
  }
  editorStore.insertObjects(
    selected.page.id,
    prepareObjectsForPaste(selected.objects, selected.page, PASTE_OFFSET)
  );
  return true;
};

/** Start size for a placed image: at most 40% of the page width, never enlarged. */
export const fitImageToPage = (image: Size, pageWidth: number): Size => {
  const scale = Math.min(
    1,
    (pageWidth * PASTED_IMAGE_MAX_WIDTH_RATIO) / image.width
  );
  return { height: image.height * scale, width: image.width * scale };
};

/** A text box holding pasted plain text, wrapped and centered on the page. */
export const createPastedTextObject = (
  content: string,
  style: TextStyleDefaults,
  page: Pick<EditorPage, "height" | "width">
): TextObject => {
  const text = content.replaceAll("\r\n", "\n").slice(0, MAX_PASTED_TEXT);
  const measure = (line: string): number => canvasTextWidth(line, style);
  const maxWidth = page.width * PASTED_TEXT_MAX_WIDTH_RATIO;
  const lines = wrapText(text, maxWidth, measure);
  const width = Math.min(
    maxWidth,
    Math.max(...lines.map(measure), style.fontSize) + TEXT_WIDTH_SLACK
  );
  const height = Math.min(
    page.height,
    lines.length * style.fontSize * TEXT_LINE_HEIGHT
  );
  return createTextObject(
    {
      x: Math.max(0, (page.width - width) / 2),
      y: Math.max(0, (page.height - height) / 2),
    },
    { ...style, content: text, height, width }
  );
};
