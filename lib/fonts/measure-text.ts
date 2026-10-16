import type { FontFamily, FontWeight } from "@/lib/editor/types";

export const FONT_FILES = {
  /** Figma's default face; only fetched when a Figma run's widths match it. */
  inter: {
    400: "/fonts/Inter-Regular.ttf",
    600: "/fonts/Inter-SemiBold.ttf",
  },
  sans: {
    400: "/fonts/LiberationSans-Regular.ttf",
    700: "/fonts/LiberationSans-Bold.ttf",
    italic400: "/fonts/LiberationSans-Italic.ttf",
    italic700: "/fonts/LiberationSans-BoldItalic.ttf",
  },
} as const;

/** Liberation Sans Regular hhea.ascent / unitsPerEm (1854 / 2048). */
export const LIBERATION_SANS_ASCENT_RATIO = 1854 / 2048;

/** Liberation Sans Regular hhea.descent / unitsPerEm (434 / 2048). */
export const LIBERATION_SANS_DESCENT_RATIO = 434 / 2048;

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

/** Hover hit-tests and overlay renders re-measure the same runs constantly. */
const MAX_WIDTH_CACHE_ENTRIES = 5000;

const widthCache = new Map<string, number>();

/** Pinch zoom produces many sizes; drop the cache rather than let it grow. */
const MAX_BASELINE_CACHE_ENTRIES = 500;

const baselineRatioCache = new Map<string, number>();
let watchingFontLoads = false;

const watchFontLoads = (): void => {
  if (watchingFontLoads || !document.fonts) {
    return;
  }
  watchingFontLoads = true;
  // A face that finishes loading changes the metrics of every key using it.
  document.fonts.addEventListener("loadingdone", () => {
    baselineRatioCache.clear();
    widthCache.clear();
  });
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

  const font = canvasFont(options);
  const key = `${font}\0${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  watchFontLoads();
  context.font = font;
  const { width } = context.measureText(text);
  if (widthCache.size >= MAX_WIDTH_CACHE_ENTRIES) {
    widthCache.clear();
  }
  widthCache.set(key, width);
  return width;
};

/**
 * Baseline from the top of a `line-height: 1` box in Liberation Sans, as a
 * fraction of the font size. CSS half-leading `(1 - (A + D)) / 2` is negative
 * here, so the baseline sits above the bare ascent.
 */
export const LIBERATION_SANS_LINE_BOX_BASELINE_RATIO =
  (1 + LIBERATION_SANS_ASCENT_RATIO - LIBERATION_SANS_DESCENT_RATIO) / 2;

const measureLineBoxBaseline = (font: string, fontSize: number): number => {
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:nowrap";
  box.style.font = font;
  // After `font`: the shorthand resets line-height to normal.
  box.style.lineHeight = "1";
  box.textContent = "H";
  const probe = document.createElement("span");
  probe.style.cssText =
    "display:inline-block;width:0;height:0;vertical-align:baseline";
  box.append(probe);
  document.body.append(box);
  const baseline =
    probe.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
  box.remove();
  return baseline / fontSize;
};

/**
 * Where the browser paints the baseline inside a `line-height: 1` box, as a
 * fraction of the font size. Measured in the DOM because the browser snaps
 * ascent and descent to pixels, so the ratio changes with size and face.
 */
export const cssLineBoxBaselineRatio = (options: CanvasFontOptions): number => {
  const hasLayout =
    typeof document !== "undefined" &&
    document.body !== null &&
    options.fontSize > 0;
  if (!hasLayout) {
    return LIBERATION_SANS_LINE_BOX_BASELINE_RATIO;
  }
  const font = canvasFont(options);
  const cached = baselineRatioCache.get(font);
  if (cached !== undefined) {
    return cached;
  }
  watchFontLoads();
  const ratio = measureLineBoxBaseline(font, options.fontSize);
  if (!(Number.isFinite(ratio) && ratio > 0)) {
    return LIBERATION_SANS_LINE_BOX_BASELINE_RATIO;
  }
  if (baselineRatioCache.size >= MAX_BASELINE_CACHE_ENTRIES) {
    baselineRatioCache.clear();
  }
  baselineRatioCache.set(font, ratio);
  return ratio;
};
