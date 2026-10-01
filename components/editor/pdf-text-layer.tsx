"use client";

import { useEffect } from "react";

import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import { isPdfTextDirty, pdfTextOverlayBox } from "@/lib/editor/object-utils";
import type { PdfTextObject } from "@/lib/editor/types";
import {
  canvasTextWidth,
  ensureEditorFonts,
  fontFamilyCss,
} from "@/lib/fonts/measure-text";
import { cn } from "@/lib/utils";

const REPLACEMENT_COLOR = "#111827";

const measuredPdfTextWidth = (object: PdfTextObject): number =>
  canvasTextWidth(object.text, {
    fontFamily: object.fontFamily ?? "sans",
    fontSize: object.fontSize ?? object.height,
    fontWeight: object.fontWeight ?? 400,
    italic: object.italic === true,
  });

const overlayFrame = (object: PdfTextObject) =>
  pdfTextOverlayBox(object, measuredPdfTextWidth(object));

export const PdfTextLayer = ({
  hoveredId,
  objects,
  selectedId,
  zoom,
}: {
  hoveredId: string | null;
  objects: readonly PdfTextObject[];
  selectedId: string | null;
  zoom: number;
}) => {
  const hasDirty = objects.some((object) => isPdfTextDirty(object));

  useEffect(() => {
    void ensureEditorFonts();
  }, []);

  useEffect(() => {
    if (hasDirty) {
      void ensureEditorFonts();
    }
  }, [hasDirty]);

  return (
    <>
      {objects.map((object) =>
        isPdfTextDirty(object) ? (
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
        ) : null
      )}
      {objects.map((object) => {
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
