import type { FontFamily, FontWeight } from "@/lib/editor/types";

export const FONT_FILES = {
  sans: {
    400: "/fonts/LiberationSans-Regular.ttf",
    700: "/fonts/LiberationSans-Bold.ttf",
    italic400: "/fonts/LiberationSans-Italic.ttf",
    italic700: "/fonts/LiberationSans-BoldItalic.ttf",
  },
} as const;

/** Liberation Sans Regular hhea.ascent / unitsPerEm (1854 / 2048). */
export const LIBERATION_SANS_ASCENT_RATIO = 1854 / 2048;

export const fontFamilyCss = (family: FontFamily): string => {
  switch (family) {
    case "serif": {
      return '"Times New Roman", Times, serif';
    }
    case "mono": {
      return "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    }
    default: {
      return '"Liberation Sans", Arial, sans-serif';
    }
  }
};

const EDITOR_FONT_LOADS = [
  '400 16px "Liberation Sans"',
  '700 16px "Liberation Sans"',
  'italic 400 16px "Liberation Sans"',
  'italic 700 16px "Liberation Sans"',
] as const;

let editorFontsPromise: Promise<void> | null = null;

/** Ensure Liberation @font-face variants are ready before dirty PDF text paints. */
export const ensureEditorFonts = (): Promise<void> => {
  if (typeof document === "undefined" || !document.fonts) {
    return Promise.resolve();
  }
  if (!editorFontsPromise) {
    editorFontsPromise = (async () => {
      await Promise.all(
        EDITOR_FONT_LOADS.map((descriptor) => document.fonts.load(descriptor))
      );
    })();
  }
  return editorFontsPromise;
};

export const wrapText = (
  text: string,
  maxWidth: number,
  measure: (line: string) => number
): string[] => {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const next = current.length === 0 ? word : `${current} ${word}`;
      if (measure(next) <= maxWidth || current.length === 0) {
        current = next;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  return lines;
};

export interface PdfTextGlyphInk {
  ascent: number;
  descent: number;
  /** Left edge of the glyph ink, in font-size pixels, from the start of the string. */
  left: number;
  width: number;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** One shared 2D context; measuring runs on every render of a dirty run. */
const sharedMeasureContext = (): CanvasRenderingContext2D | null => {
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  return measureContext;
};

/** A canvas `font` shorthand's inputs; `familyCss` overrides the bundled family. */
export interface CanvasFontOptions {
  familyCss?: string;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  italic: boolean;
}

const canvasFont = (options: CanvasFontOptions): string => {
  const family = options.familyCss ?? fontFamilyCss(options.fontFamily);
  const style = options.italic ? "italic " : "";
  return `${style}${options.fontWeight} ${options.fontSize}px ${family}`;
};

/** Per-glyph ink for the original string. Null when canvas metrics are unavailable. */
export const measurePdfTextGlyphInk = (
  text: string,
  options: CanvasFontOptions
): PdfTextGlyphInk[] | null => {
  if (typeof document === "undefined" || text.length === 0) {
    return null;
  }
  const context = sharedMeasureContext();
  if (!context) {
    return null;
  }
  context.font = canvasFont(options);
  const glyphs: PdfTextGlyphInk[] = [];
  let cursor = 0;
  for (const char of text) {
    const metrics = context.measureText(char);
    const { actualBoundingBoxAscent, actualBoundingBoxDescent, width } =
      metrics;
    const leftBearing = metrics.actualBoundingBoxLeft;
    const rightBearing = metrics.actualBoundingBoxRight;
    if (
      !Number.isFinite(actualBoundingBoxAscent) ||
      !Number.isFinite(actualBoundingBoxDescent) ||
      !Number.isFinite(width)
    ) {
      return null;
    }
    const left = Number.isFinite(leftBearing) ? leftBearing : 0;
    const right = Number.isFinite(rightBearing) ? rightBearing : width;
    const inkWidth = Math.max(0, left + right);
    if (
      inkWidth > 0 &&
      actualBoundingBoxAscent + actualBoundingBoxDescent > 0
    ) {
      glyphs.push({
        ascent: actualBoundingBoxAscent,
        descent: actualBoundingBoxDescent,
        left: cursor - left,
        width: inkWidth,
      });
    }
    cursor += width;
  }
  if (glyphs.length === 0) {
    return null;
  }
  return glyphs;
};

export const canvasTextWidth = (
  text: string,
  options: CanvasFontOptions
): number => {
  if (typeof document === "undefined") {
    return text.length * options.fontSize * 0.5;
  }

  const context = sharedMeasureContext();
  if (!context) {
    return text.length * options.fontSize * 0.5;
  }

  context.font = canvasFont(options);
  return context.measureText(text).width;
};

export const cssFontAscentRatio = (
  family: FontFamily,
  weight: FontWeight,
  italic: boolean
): number => {
  if (typeof document === "undefined") {
    return LIBERATION_SANS_ASCENT_RATIO;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return LIBERATION_SANS_ASCENT_RATIO;
  }
  const fontSize = 100;
  context.font = `${italic ? "italic " : ""}${weight} ${fontSize}px ${fontFamilyCss(family)}`;
  const metrics = context.measureText("");
  const ascent = metrics.emHeightAscent || metrics.fontBoundingBoxAscent;
  const hasAscent = Number.isFinite(ascent) && ascent > 0;
  if (!hasAscent) {
    return LIBERATION_SANS_ASCENT_RATIO;
  }
  return ascent / fontSize;
};
