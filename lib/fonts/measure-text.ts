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

export const canvasTextWidth = (
  text: string,
  options: {
    fontFamily: FontFamily;
    fontSize: number;
    fontWeight: FontWeight;
    italic: boolean;
  }
): number => {
  if (typeof document === "undefined") {
    return text.length * options.fontSize * 0.5;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return text.length * options.fontSize * 0.5;
  }

  context.font = `${options.italic ? "italic " : ""}${options.fontWeight} ${options.fontSize}px ${fontFamilyCss(options.fontFamily)}`;
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
