"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import {
  captionUnderlineCssOffsetFromRunTop,
  fittedPdfTextBox,
  isPdfTextDirty,
  measurePdfTextWidth,
  pdfLinkTextAppearance,
  pdfTextCssInkOffsetFromRunTop,
  pdfTextCoverColor,
  pdfTextCoverRects,
  pdfTextNeedsFill,
  pdfTextNeedsStroke,
  pdfTextOverlayBox,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject, Rect } from "@/lib/editor/types";
import {
  cssFontAscentRatio,
  ensureEditorFonts,
  LIBERATION_SANS_ASCENT_RATIO,
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

const inkAscentRatio = (object: PdfTextObject, fontsReady: boolean): number => {
  if (!fontsReady) {
    return LIBERATION_SANS_ASCENT_RATIO;
  }
  return cssFontAscentRatio(
    object.fontFamily ?? "sans",
    object.fontWeight ?? 400,
    object.italic === true
  );
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
  const frame = overlayFrame(object, value);
  const fontSize = object.fontSize ?? object.height;
  const fontSizeCss = pageToCss(fontSize, zoom);
  const covers = pdfTextCoverRects(object, page);
  const inkTop = pdfTextCssInkOffsetFromRunTop(
    object,
    frame,
    page.cropBox,
    page.sourceRotate,
    inkAscentRatio(object, fontsReady)
  );

  useEffect(() => {
    void ensureEditorFonts();
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const { length } = input.value;
    input.setSelectionRange(length, length);
  }, []);

  // Measure the original ink and font once, before the first keystroke lands.
  // The result is keyed by ids and still applies if the editor closes first.
  useEffect(() => {
    void ensurePdfTextMeasured(page, object, zoom);
  }, [object, page, zoom]);

  const commit = (next: string): void => {
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
      <input
        aria-label="Edit PDF text"
        className="absolute left-0 min-w-0 border-0 bg-transparent p-0 outline-none select-text"
        dir={object.dir === "rtl" ? "rtl" : "ltr"}
        onBlur={() => {
          if (discardRef.current) {
            discardRef.current = false;
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

export const PdfTextLayer = ({
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
        if (!isPdfTextDirty(object)) {
          return null;
        }
        const linkAppearance = pdfLinkTextAppearance(page, object);
        const fillColor = linkAppearance?.fillColor ?? object.color;
        const underline = linkAppearance?.underline;
        const frame = overlayFrame(object);
        const fontSize = object.fontSize ?? object.height;
        const covers = pdfTextCoverRects(object, page);
        const inkTop = pdfTextCssInkOffsetFromRunTop(
          object,
          frame,
          page.cropBox,
          page.sourceRotate,
          inkAscentRatio(object, fontsReady)
        );
        return (
          <div
            className="pointer-events-none absolute origin-center"
            key={`dirty-${object.id}`}
            style={objectWrapperStyle({ ...frame, rotation: 0 }, zoom)}
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
            <div
              className="absolute left-0 whitespace-nowrap"
              style={{
                ...pdfTextInkStyle(
                  object,
                  object.text,
                  pageToCss(fontSize, zoom),
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
