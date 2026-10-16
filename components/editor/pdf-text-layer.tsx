"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { PdfVectorCover } from "@/components/editor/pdf-vector-layer";
import {
  RebuiltGlyphSvg,
  RebuiltGlyphText,
  useRebuiltGlyphLayout,
} from "@/components/editor/rebuilt-glyph-text";
import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import {
  captionUnderlineCssOffsetFromRunTop,
  fittedPdfTextBox,
  isPdfTextDirty,
  measurePdfTextWidth,
  pdfLinkTextAppearance,
  pdfTextCanvasFont,
  pdfTextCssInkOffsetFromRunTop,
  pdfTextCoverColor,
  pdfTextCoverRects,
  pdfTextInkCoverStyle,
  pdfTextInkOutline,
  pdfTextNeedsFill,
  pdfTextNeedsStroke,
  pdfTextOverlayBox,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject, Rect } from "@/lib/editor/types";
import {
  cssLineBoxBaselineRatio,
  ensureEditorFonts,
  LIBERATION_SANS_LINE_BOX_BASELINE_RATIO,
} from "@/lib/fonts/measure-text";
import { pdfTextPreviewFontCss } from "@/lib/pdf/embedded-font";
import { ensurePdfTextMeasured } from "@/lib/pdf/sample-pdf-text-cover";
import { cn } from "@/lib/utils";

const pdfTextInkStyle = (
  object: PdfTextObject,
  text: string,
  fontSizeCss: number,
  zoom: number,
  fillColor: string = object.color
): CSSProperties => {
  const fill = pdfTextNeedsFill(object.textRenderingMode);
  const stroke = pdfTextNeedsStroke(object.textRenderingMode);
  const strokeWidthCss = pageToCss(object.strokeWidth, zoom);
  return {
    WebkitTextStroke: stroke
      ? `${strokeWidthCss}px ${object.strokeColor}`
      : undefined,
    color: fill ? fillColor : "transparent",
    fontFamily: pdfTextPreviewFontCss(object, text),
    fontSize: fontSizeCss,
    fontStyle: object.italic === true ? "italic" : "normal",
    fontWeight: object.fontWeight ?? 400,
    lineHeight: 1,
    paintOrder: stroke ? "stroke fill" : undefined,
  };
};

const overlayFrame = (
  object: PdfTextObject,
  text: string = object.text
): ReturnType<typeof pdfTextOverlayBox> => {
  const measured = measurePdfTextWidth(object, text);
  if (text !== object.text) {
    return fittedPdfTextBox(object, measured);
  }
  return pdfTextOverlayBox(object, measured);
};

/** Baseline ratio for the exact face and CSS size `pdfTextInkStyle` paints. */
const inkBaselineRatio = (
  object: PdfTextObject,
  text: string,
  fontSizeCss: number,
  fontsReady: boolean
): number => {
  if (!fontsReady) {
    return LIBERATION_SANS_LINE_BOX_BASELINE_RATIO;
  }
  return cssLineBoxBaselineRatio({
    ...pdfTextCanvasFont(object, text),
    fontSize: fontSizeCss,
  });
};

const PdfTextCoverPlate = ({
  cover,
  coverColor,
  runBox,
  zoom,
}: {
  cover: Rect;
  coverColor: string;
  runBox: Rect;
  zoom: number;
}) => (
  <div
    className="absolute"
    style={{
      backgroundColor: coverColor,
      height: pageToCss(cover.height, zoom),
      left: pageToCss(cover.x - runBox.x, zoom),
      top: pageToCss(cover.y - runBox.y, zoom),
      width: pageToCss(cover.width, zoom),
    }}
  />
);

const PdfTextEditor = ({
  fontsReady,
  object,
  onExit,
  page,
  zoom,
}: {
  fontsReady: boolean;
  object: PdfTextObject;
  onExit: () => void;
  page: EditorPage;
  zoom: number;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? object.text;
  // Latest draft for the unmount commit: a click elsewhere on the page can
  // close the editor before the input ever sees a blur.
  const pendingRef = useRef({
    objectId: object.id,
    pageId: page.id,
    text: object.text,
    value,
  });
  const settledRef = useRef(false);

  useEffect(() => {
    pendingRef.current = {
      objectId: object.id,
      pageId: page.id,
      text: object.text,
      value,
    };
  }, [object.id, object.text, page.id, value]);
  const frame = overlayFrame(object, value);
  const rebuilt = useRebuiltGlyphLayout(object, page, value);
  const fontSize = object.fontSize ?? object.height;
  const fontSizeCss = pageToCss(fontSize, zoom);
  // Keystrokes only change `draft`; until measurement lands this walks the
  // whole page, so compute it once per run and page version.
  // A run that owns its outline is covered by repainting that path at page
  // level (see PdfTextInkCover); rect plates would blank neighbouring art.
  const covers = useMemo(
    () =>
      pdfTextInkOutline(object, page) ? [] : pdfTextCoverRects(object, page),
    [object, page]
  );
  const inkTop = pdfTextCssInkOffsetFromRunTop(
    object,
    frame,
    page.cropBox,
    page.sourceRotate,
    inkBaselineRatio(object, value, fontSizeCss, fontsReady)
  );

  useEffect(() => {
    void ensureEditorFonts();
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const { length } = input.value;
    input.setSelectionRange(length, length);
  }, []);

  // Measure the original ink and font once, before the first keystroke lands.
  // The result is keyed by ids and still applies if the editor closes first.
  useEffect(() => {
    void ensurePdfTextMeasured(page, object, zoom);
  }, [object, page, zoom]);

  useEffect(
    () => () => {
      if (settledRef.current || discardRef.current) {
        return;
      }
      const { objectId, pageId, text, value: pending } = pendingRef.current;
      if (pending === text) {
        return;
      }
      editorStore.patchPdfTextById(pageId, objectId, (current) => ({
        ...current,
        text: pending,
      }));
    },
    []
  );

  const commit = (next: string): void => {
    settledRef.current = true;
    if (next !== object.text) {
      editorStore.patchPdfTextById(page.id, object.id, (current) => ({
        ...current,
        text: next,
      }));
    }
    onExit();
  };

  return (
    <div
      className="absolute origin-center"
      style={objectWrapperStyle({ ...frame, rotation: object.rotation }, zoom)}
    >
      {covers.map((cover) => (
        <PdfTextCoverPlate
          cover={cover}
          coverColor={pdfTextCoverColor(object)}
          key={`${cover.x}:${cover.y}:${cover.width}:${cover.height}`}
          runBox={frame}
          zoom={zoom}
        />
      ))}
      {rebuilt ? (
        <RebuiltGlyphSvg
          fill={object.color}
          frame={frame}
          layout={rebuilt}
          object={object}
          page={page}
          zoom={zoom}
        />
      ) : null}
      <input
        aria-label="Edit PDF text"
        className="absolute left-0 min-w-0 border-0 bg-transparent p-0 outline-none select-text"
        dir={object.dir === "rtl" ? "rtl" : "ltr"}
        onBlur={() => {
          if (discardRef.current) {
            discardRef.current = false;
            settledRef.current = true;
            onExit();
            return;
          }
          commit(value);
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            discardRef.current = true;
            event.currentTarget.blur();
          }
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        ref={inputRef}
        style={{
          ...pdfTextInkStyle(object, value, fontSizeCss, zoom),
          // The rebuilt glyphs above are the visible text; keep the caret.
          ...(rebuilt
            ? { caretColor: object.color, color: "transparent" }
            : undefined),
          height: fontSizeCss,
          top: pageToCss(inkTop, zoom),
          width: "100%",
        }}
        type="text"
        value={value}
      />
    </div>
  );
};

const PdfTextLayerView = ({
  editingId,
  hoveredId,
  objects,
  onExitEdit,
  page,
  selectedId,
  zoom,
}: {
  editingId: string | null;
  hoveredId: string | null;
  objects: readonly PdfTextObject[];
  onExitEdit: () => void;
  page: EditorPage;
  selectedId: string | null;
  zoom: number;
}) => {
  const hasDirty = objects.some((object) => isPdfTextDirty(object));
  const isEditing = editingId !== null;
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    const loadFonts = async (): Promise<void> => {
      await ensureEditorFonts();
      setFontsReady(true);
    };
    void loadFonts();
  }, []);

  useEffect(() => {
    if (!(hasDirty || isEditing)) {
      return;
    }
    const loadFonts = async (): Promise<void> => {
      await ensureEditorFonts();
      setFontsReady(true);
    };
    void loadFonts();
  }, [hasDirty, isEditing]);

  return (
    <>
      {objects.map((object) => {
        const outline = pdfTextInkOutline(object, page);
        if (!(outline && (object.id === editingId || isPdfTextDirty(object)))) {
          return null;
        }
        return (
          <PdfVectorCover
            crop={page.cropBox}
            key={`ink-cover-${object.id}`}
            object={outline}
            sourceRotate={page.sourceRotate}
            style={pdfTextInkCoverStyle(pdfTextCoverColor(object))}
            zoom={zoom}
          />
        );
      })}
      {objects.map((object) => {
        if (
          object.id === editingId ||
          !isPdfTextDirty(object) ||
          pdfTextInkOutline(object, page)
        ) {
          return null;
        }
        // Covers paint in their own pass, under every run's text and the
        // inline editor: a run emptied by a link label edit must not hide
        // the caption drawn by the run before it.
        const frame = overlayFrame(object);
        return (
          <div
            className="pointer-events-none absolute origin-center"
            key={`cover-${object.id}`}
            style={objectWrapperStyle({ ...frame, rotation: 0 }, zoom)}
          >
            {pdfTextCoverRects(object, page).map((cover) => (
              <PdfTextCoverPlate
                cover={cover}
                coverColor={pdfTextCoverColor(object)}
                key={`${cover.x}:${cover.y}:${cover.width}:${cover.height}`}
                runBox={frame}
                zoom={zoom}
              />
            ))}
          </div>
        );
      })}
      {objects.map((object) => {
        if (object.id === editingId) {
          return (
            <PdfTextEditor
              fontsReady={fontsReady}
              key={`edit-${object.id}`}
              object={object}
              onExit={onExitEdit}
              page={page}
              zoom={zoom}
            />
          );
        }
        if (!isPdfTextDirty(object) || object.text === "") {
          return null;
        }
        const linkAppearance = pdfLinkTextAppearance(page, object);
        const fillColor = linkAppearance?.fillColor ?? object.color;
        const underline = linkAppearance?.underline;
        const frame = overlayFrame(object);
        const fontSizeCss = pageToCss(object.fontSize ?? object.height, zoom);
        const inkTop = pdfTextCssInkOffsetFromRunTop(
          object,
          frame,
          page.cropBox,
          page.sourceRotate,
          inkBaselineRatio(object, object.text, fontSizeCss, fontsReady)
        );
        return (
          <div
            className="pointer-events-none absolute origin-center"
            key={`dirty-${object.id}`}
            style={objectWrapperStyle({ ...frame, rotation: 0 }, zoom)}
          >
            <RebuiltGlyphText
              fill={fillColor}
              frame={frame}
              object={object}
              page={page}
              zoom={zoom}
            >
              <div
                className="absolute left-0 whitespace-nowrap"
                style={{
                  ...pdfTextInkStyle(
                    object,
                    object.text,
                    fontSizeCss,
                    zoom,
                    fillColor
                  ),
                  top: pageToCss(inkTop, zoom),
                  transform:
                    object.rotation === 0
                      ? undefined
                      : `rotate(${object.rotation}deg)`,
                  transformOrigin: "left top",
                }}
              >
                {object.text}
              </div>
            </RebuiltGlyphText>
            {underline ? (
              <div
                className="absolute left-0"
                style={{
                  backgroundColor: underline.color,
                  height: pageToCss(underline.thickness, zoom),
                  top: pageToCss(
                    captionUnderlineCssOffsetFromRunTop(underline),
                    zoom
                  ),
                  width: "100%",
                }}
              />
            ) : null}
          </div>
        );
      })}
      {objects.map((object) => {
        if (object.id === editingId) {
          return null;
        }
        const hovered = object.id === hoveredId;
        const selected = object.id === selectedId;
        if (!hovered && !selected) {
          return null;
        }
        return (
          <div
            className={cn(
              "pointer-events-none absolute origin-center",
              selected
                ? "outline-primary outline"
                : "outline-primary/40 outline"
            )}
            key={`chrome-${object.id}`}
            style={objectWrapperStyle(
              { ...overlayFrame(object), rotation: 0 },
              zoom
            )}
          />
        );
      })}
    </>
  );
};

/** Memoized: the overlay re-renders on hover and selection changes this layer may not use. */
export const PdfTextLayer = memo(PdfTextLayerView);
