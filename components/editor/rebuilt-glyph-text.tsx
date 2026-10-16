"use client";

import { useMemo } from "react";

import { pageToCss, pdfTextBaselineDisplayed } from "@/lib/editor/coordinates";
import { useEditorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject, Rect } from "@/lib/editor/types";
import { figmaFallbackFor } from "@/lib/pdf/figma-fallback";
import { glyphLayoutSvgPath, rebuiltGlyphLayout } from "@/lib/pdf/glyph-face";
import type { GlyphLayout } from "@/lib/pdf/glyph-face";

/** Room above and below the baseline for ascenders and descenders, in em. */
const ASCENT_ROOM_EM = 1.2;
const DESCENT_ROOM_EM = 0.5;

/**
 * `text` laid out in the run's own rebuilt Figma face, or null when the run
 * must use a substitute. Reads the whole document: a face is gathered from
 * every page that uses it.
 */
export const useRebuiltGlyphLayout = (
  object: PdfTextObject,
  page: EditorPage,
  text: string
): GlyphLayout | null => {
  const pages = useEditorStore((state) => state.document.pages);
  return useMemo(
    () =>
      object.invisibleGlyphs === true
        ? rebuiltGlyphLayout(pages, page, { ...object, text })
        : null,
    [object, page, pages, text]
  );
};

/** Rebuilt glyphs drawn as one SVG path at the run's baseline. */
export const RebuiltGlyphSvg = ({
  fill,
  frame,
  layout,
  object,
  page,
  zoom,
}: {
  fill: string;
  /** The box the parent positions; the SVG sits relative to it. */
  frame: Rect;
  layout: GlyphLayout;
  object: PdfTextObject;
  page: EditorPage;
  zoom: number;
}) => {
  const size = object.fontSize ?? object.height;
  const baseline = pdfTextBaselineDisplayed(
    object.transform,
    page.cropBox,
    page.sourceRotate
  );
  const ascent = size * ASCENT_ROOM_EM;
  const height = ascent + size * DESCENT_ROOM_EM;
  const width = Math.max(layout.width * size, 1e-3);
  const d = useMemo(() => glyphLayoutSvgPath(layout, size), [layout, size]);
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute overflow-visible"
      height={pageToCss(height, zoom)}
      style={{
        left: pageToCss(baseline.x - frame.x, zoom),
        top: pageToCss(baseline.y - frame.y - ascent, zoom),
      }}
      viewBox={`0 ${-ascent} ${width} ${height}`}
      width={pageToCss(width, zoom)}
    >
      <path d={d} fill={fill} />
    </svg>
  );
};

const FALLBACK_FAMILIES = {
  inter: '"Paperoo Inter", "Liberation Sans", Arial, sans-serif',
  liberation: '"Liberation Sans", Arial, sans-serif',
} as const;

/**
 * CSS for a Figma run drawn in its substitute (same face, weight and letter
 * spacing as export), or null when the run is not a Figma fallback.
 */
export const useFigmaFallbackCss = (
  object: PdfTextObject,
  page: EditorPage,
  text: string
): React.CSSProperties | null => {
  const pages = useEditorStore((state) => state.document.pages);
  return useMemo(() => {
    const style = figmaFallbackFor(pages, page, { ...object, text });
    return style
      ? {
          fontFamily: FALLBACK_FAMILIES[style.family],
          fontWeight: style.weight,
          letterSpacing: `${style.letterSpacingEm}em`,
        }
      : null;
  }, [object, page, pages, text]);
};

/**
 * The run's text in its rebuilt face when possible, else `children`, called
 * with the Figma fallback CSS (null for other runs).
 */
export const RebuiltGlyphText = ({
  children,
  fill,
  frame,
  object,
  page,
  zoom,
}: {
  children: (fallbackCss: React.CSSProperties | null) => React.ReactNode;
  fill: string;
  frame: Rect;
  object: PdfTextObject;
  page: EditorPage;
  zoom: number;
}) => {
  const layout = useRebuiltGlyphLayout(object, page, object.text);
  const fallbackCss = useFigmaFallbackCss(object, page, object.text);
  if (!layout) {
    return children(fallbackCss);
  }
  return (
    <RebuiltGlyphSvg
      fill={fill}
      frame={frame}
      layout={layout}
      object={object}
      page={page}
      zoom={zoom}
    />
  );
};
