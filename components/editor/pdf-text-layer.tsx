"use client";

import { useEffect, useRef, useState } from "react";

import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import {
  fittedPdfTextBox,
  isPdfTextDirty,
  measurePdfTextWidth,
  pdfTextOverlayBox,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { PdfTextObject } from "@/lib/editor/types";
import { ensureEditorFonts, fontFamilyCss } from "@/lib/fonts/measure-text";
import { cn } from "@/lib/utils";

const REPLACEMENT_COLOR = "#111827";

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

const PdfTextEditor = ({
  object,
  onExit,
  zoom,
}: {
  object: PdfTextObject;
  onExit: () => void;
  zoom: number;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? object.text;
  const frame = overlayFrame(object, value);
  const fontSizeCss = pageToCss(object.fontSize ?? object.height, zoom);

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

  const commit = (next: string): void => {
    if (next !== object.text) {
      editorStore.patchPdfText((current) => ({ ...current, text: next }));
    }
    onExit();
  };

  return (
    <div
      className="absolute origin-center"
      style={objectWrapperStyle({ ...frame, rotation: object.rotation }, zoom)}
    >
      <div className="absolute inset-0 bg-white" />
      <input
        aria-label="Edit PDF text"
        className="relative h-full w-full min-w-0 border-0 bg-transparent p-0 outline-none select-text"
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
          color: REPLACEMENT_COLOR,
          fontFamily: fontFamilyCss(object.fontFamily ?? "sans"),
          fontSize: fontSizeCss,
          fontStyle: object.italic === true ? "italic" : "normal",
          fontWeight: object.fontWeight ?? 400,
          lineHeight: 1,
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
  selectedId,
  zoom,
}: {
  editingId: string | null;
  hoveredId: string | null;
  objects: readonly PdfTextObject[];
  onExitEdit: () => void;
  selectedId: string | null;
  zoom: number;
}) => {
  const hasDirty = objects.some((object) => isPdfTextDirty(object));
  const isEditing = editingId !== null;

  useEffect(() => {
    void ensureEditorFonts();
  }, []);

  useEffect(() => {
    if (hasDirty || isEditing) {
      void ensureEditorFonts();
    }
  }, [hasDirty, isEditing]);

  return (
    <>
      {objects.map((object) => {
        if (object.id === editingId) {
          return (
            <PdfTextEditor
              key={`edit-${object.id}`}
              object={object}
              onExit={onExitEdit}
              zoom={zoom}
            />
          );
        }
        if (!isPdfTextDirty(object)) {
          return null;
        }
        return (
          <div
            className="pointer-events-none absolute origin-center"
            key={`dirty-${object.id}`}
            style={objectWrapperStyle(
              { ...overlayFrame(object), rotation: 0 },
              zoom
            )}
          >
            <div className="absolute inset-0 bg-white" />
            <div
              className="relative h-full w-full whitespace-nowrap"
              style={{
                color: REPLACEMENT_COLOR,
                fontFamily: fontFamilyCss(object.fontFamily ?? "sans"),
                fontSize: pageToCss(object.fontSize ?? object.height, zoom),
                fontStyle: object.italic === true ? "italic" : "normal",
                fontWeight: object.fontWeight ?? 400,
                lineHeight: 1,
                transform:
                  object.rotation === 0
                    ? undefined
                    : `rotate(${object.rotation}deg)`,
                transformOrigin: "left center",
              }}
            >
              {object.text}
            </div>
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
