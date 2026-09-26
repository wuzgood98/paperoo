import {
  DEFAULT_ASCENT_RATIO,
  textItemToDisplayedBox,
} from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type {
  CropBox,
  FontFamily,
  PageRotation,
  PdfTextDir,
  PdfTextObject,
  PdfTextTransform,
} from "@/lib/editor/types";

export interface ExtractableTextStyle {
  ascent?: number;
  descent?: number;
  fontFamily?: string;
}

export interface ExtractableTextItem {
  dir?: string;
  fontName?: string;
  hasEOL?: boolean;
  height?: number;
  str?: string;
  transform?: readonly number[];
  width?: number;
}

export interface ExtractableTextMarkedContent {
  items?: readonly ExtractableTextEntry[];
  type: string;
}

export type ExtractableTextEntry =
  | ExtractableTextItem
  | ExtractableTextMarkedContent;

export interface ExtractableTextContent {
  items: readonly ExtractableTextItem[];
  styles: Record<string, ExtractableTextStyle | undefined>;
}

export interface PdfJsTextContent {
  items: readonly ExtractableTextEntry[];
  styles: Record<string, ExtractableTextStyle | undefined>;
}

const isTextItem = (
  entry: ExtractableTextEntry
): entry is ExtractableTextItem => !("type" in entry);

export const toExtractableTextContent = (
  content: PdfJsTextContent
): ExtractableTextContent => ({
  items: content.items.filter(isTextItem),
  styles: content.styles,
});

export const resolvePdfFont = (fontFamily?: string): FontFamily => {
  if (fontFamily === "serif") {
    return "serif";
  }
  if (fontFamily === "monospace") {
    return "mono";
  }
  return "sans";
};

const toDir = (value: string | undefined): PdfTextDir => {
  if (value === "rtl" || value === "ttb") {
    return value;
  }
  return "ltr";
};

const toTransform = (
  value: readonly number[] | undefined
): PdfTextTransform | null => {
  if (!value || value.length < 6) {
    return null;
  }
  const [a, b, c, d, e, f] = value;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined ||
    ![a, b, c, d, e, f].every(Number.isFinite)
  ) {
    return null;
  }
  return [a, b, c, d, e, f];
};

export const extractPdfTextObjects = (
  content: ExtractableTextContent,
  page: {
    cropBox: CropBox;
    id: string;
    sourceRotate: PageRotation;
  }
): PdfTextObject[] => {
  const objects: PdfTextObject[] = [];

  for (const [sourceIndex, item] of content.items.entries()) {
    const transform = toTransform(item.transform);
    if (!transform || item.str === undefined) {
      continue;
    }

    const style = item.fontName ? content.styles[item.fontName] : undefined;
    const fontFamily = resolvePdfFont(style?.fontFamily);
    const box = textItemToDisplayedBox(
      transform,
      item.width ?? 0,
      item.height ?? 0,
      style?.ascent ?? DEFAULT_ASCENT_RATIO,
      page.cropBox,
      page.sourceRotate,
      style?.descent ?? 0
    );

    objects.push({
      dir: toDir(item.dir),
      fontFamily,
      fontName: item.fontName ?? "",
      fontSize: box.fontSize,
      hasEOL: item.hasEOL === true,
      height: box.height,
      id: createId(),
      originalFontFamily: fontFamily,
      originalFontSize: box.fontSize,
      originalText: item.str,
      pageId: page.id,
      rotation: box.rotation,
      sourceIndex,
      text: item.str,
      transform,
      type: "pdf-text",
      width: box.width,
      x: box.x,
      y: box.y,
    });
  }

  return objects;
};
