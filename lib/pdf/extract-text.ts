import {
  DEFAULT_ASCENT_RATIO,
  textItemToDisplayedBox,
} from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import { DEFAULT_PDF_TEXT_COLOR } from "@/lib/editor/types";
import type {
  CropBox,
  FontFamily,
  FontWeight,
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

export interface PdfFontFaceMeta {
  bold?: boolean;
  italic?: boolean;
  name?: string;
}

/** Shape of a PDF.js FontFaceObject exported onto commonObjs. */
export interface PdfJsFontFaceData {
  black?: boolean;
  bold?: boolean;
  italic?: boolean;
  name?: string;
}

export interface PdfJsFontObjectStore {
  get: (
    id: string,
    callback?: (data: PdfJsFontFaceData) => void
  ) => PdfJsFontFaceData | undefined;
  has: (id: string) => boolean;
}

const FONT_FACE_RESOLVE_MS = 2000;

const parseFontFace = (
  value: PdfJsFontFaceData | undefined
): PdfFontFaceMeta | null => {
  if (!value) {
    return null;
  }
  return {
    bold: value.bold === true || value.black === true,
    italic: value.italic === true,
    name: value.name,
  };
};

const readResolvedFontFace = (
  store: PdfJsFontObjectStore,
  loadedName: string
): PdfFontFaceMeta | null => {
  if (!store.has(loadedName)) {
    return null;
  }
  try {
    return parseFontFace(store.get(loadedName));
  } catch {
    return null;
  }
};

const resolveFontFace = (
  store: PdfJsFontObjectStore,
  loadedName: string
): Promise<PdfFontFaceMeta | null> => {
  const ready = readResolvedFontFace(store, loadedName);
  if (ready) {
    return Promise.resolve(ready);
  }

  // oxlint-disable-next-line promise/avoid-new -- PDFObjects.get only notifies through a callback
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PdfFontFaceMeta | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, FONT_FACE_RESOLVE_MS);

    store.get(loadedName, (data) => {
      const parsed = parseFontFace(data);
      if (!parsed) {
        return;
      }
      clearTimeout(timer);
      finish(parsed);
    });
  });
};

/** Resolve PDF.js Font records from commonObjs for each text-item loadedName. */
export const collectPdfFontFaces = async (
  store: PdfJsFontObjectStore,
  items: readonly ExtractableTextItem[]
): Promise<Record<string, PdfFontFaceMeta>> => {
  const loadedNames = new Set<string>();
  for (const item of items) {
    if (item.fontName) {
      loadedNames.add(item.fontName);
    }
  }

  const faces: Record<string, PdfFontFaceMeta> = {};
  await Promise.all(
    [...loadedNames].map(async (loadedName) => {
      const face = await resolveFontFace(store, loadedName);
      if (face) {
        faces[loadedName] = face;
      }
    })
  );
  return faces;
};

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

/** Match PDF.js Font.fallbackToSystemFont: /bold/i on the face name. */
export const resolvePdfFontWeight = (
  faceName?: string,
  bold?: boolean
): FontWeight => {
  if (bold === true) {
    return 700;
  }
  if (faceName && /bold|black/iu.test(faceName)) {
    return 700;
  }
  return 400;
};

/** Match PDF.js Font.fallbackToSystemFont: /oblique|italic/i on the face name. */
export const resolvePdfFontItalic = (
  faceName?: string,
  italic?: boolean
): boolean => {
  if (italic === true) {
    return true;
  }
  return Boolean(faceName && /oblique|italic/iu.test(faceName));
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

const itemColorAt = (
  itemColors: readonly string[] | undefined,
  sourceIndex: number
): string => itemColors?.[sourceIndex] ?? DEFAULT_PDF_TEXT_COLOR;

export const extractPdfTextObjects = (
  content: ExtractableTextContent,
  page: {
    cropBox: CropBox;
    id: string;
    sourceRotate: PageRotation;
  },
  fontFaces: Readonly<Record<string, PdfFontFaceMeta | undefined>> = {},
  /** Parallel to `content.items`; missing/short entries fall back to default. */
  itemColors?: readonly string[]
): PdfTextObject[] => {
  const objects: PdfTextObject[] = [];

  for (const [sourceIndex, item] of content.items.entries()) {
    const transform = toTransform(item.transform);
    if (!transform || item.str === undefined) {
      continue;
    }

    const style = item.fontName ? content.styles[item.fontName] : undefined;
    const face = item.fontName ? fontFaces[item.fontName] : undefined;
    const fontFamily = resolvePdfFont(style?.fontFamily);
    const fontWeight = resolvePdfFontWeight(face?.name, face?.bold);
    const italic = resolvePdfFontItalic(face?.name, face?.italic);
    const box = textItemToDisplayedBox(
      transform,
      item.width ?? 0,
      item.height ?? 0,
      style?.ascent ?? DEFAULT_ASCENT_RATIO,
      page.cropBox,
      page.sourceRotate,
      style?.descent ?? 0
    );
    const color = itemColorAt(itemColors, sourceIndex);

    objects.push({
      color,
      dir: toDir(item.dir),
      fontFamily,
      fontName: item.fontName ?? "",
      fontSize: box.fontSize,
      fontWeight,
      hasEOL: item.hasEOL === true,
      height: box.height,
      id: createId(),
      italic,
      originalColor: color,
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
