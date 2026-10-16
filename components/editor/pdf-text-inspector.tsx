"use client";

import { ColorField } from "@/components/editor/color-field";
import { inspectorStripClassName } from "@/components/editor/inspector-strip";
import {
  FONT_FAMILIES,
  fontFamilyFromSelect,
  roundFontSize,
} from "@/components/editor/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeHex } from "@/lib/editor/color";
import {
  isPdfTextDirty,
  pdfTextNeedsFill,
  pdfTextNeedsStroke,
  pdfTextRemovable,
} from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { embeddedFontCanDraw } from "@/lib/pdf/embedded-font";
import { figmaFallbackFor } from "@/lib/pdf/figma-fallback";
import {
  glyphSourceMessage,
  rebuiltGlyphLayout,
  resolveGlyphFace,
} from "@/lib/pdf/glyph-face";
import { ensurePdfTextMeasured } from "@/lib/pdf/sample-pdf-text-cover";

const UNKNOWN_FACE_MESSAGE =
  "Recognized text; the original font isn't available, so a substitute is used.";

/** Which glyphs an edited Figma or recognized run is drawn in; null otherwise. */
const runGlyphMessage = (
  pages: readonly EditorPage[],
  page: EditorPage,
  object: PdfTextObject
): string | null => {
  if (object.invisibleGlyphs !== true || !isPdfTextDirty(object)) {
    return null;
  }
  if (object.outlineText && !object.glyphFace) {
    return UNKNOWN_FACE_MESSAGE;
  }
  return glyphSourceMessage(
    resolveGlyphFace(pages, page.id, object),
    rebuiltGlyphLayout(pages, page, object),
    object.text,
    figmaFallbackFor(pages, page, object)?.family === "inter"
  );
};

export const PdfTextInspector = ({
  object,
  page,
}: {
  object: PdfTextObject;
  page: EditorPage;
}) => {
  const zoom = useEditorStore((state) => state.zoom);
  const pages = useEditorStore((state) => state.document.pages);
  const figmaRun = object.invisibleGlyphs === true;
  const glyphMessage = runGlyphMessage(pages, page, object);
  const showFill = pdfTextNeedsFill(object.textRenderingMode);
  const showStroke = pdfTextNeedsStroke(object.textRenderingMode);

  const patchObject = (
    updater: (current: PdfTextObject) => PdfTextObject
  ): void => {
    editorStore.patchPdfTextById(page.id, object.id, updater);
    if (isPdfTextDirty(updater(object))) {
      void ensurePdfTextMeasured(page, object, zoom);
    }
  };

  return (
    <div className={inspectorStripClassName}>
      {showFill ? (
        <ColorField
          label="Color"
          onChange={(value) => {
            const color = normalizeHex(value);
            if (color === object.color) {
              return;
            }
            patchObject((current) => ({ ...current, color }));
          }}
          value={object.color}
        />
      ) : null}
      {showStroke ? (
        <ColorField
          label="Stroke"
          onChange={(value) => {
            const strokeColor = normalizeHex(value);
            if (strokeColor === object.strokeColor) {
              return;
            }
            patchObject((current) => ({
              ...current,
              strokeColor,
            }));
          }}
          value={object.strokeColor}
        />
      ) : null}
      {showStroke ? (
        <Input
          aria-label="Stroke width"
          className="w-18"
          min={0}
          onValueChange={(value) => {
            const strokeWidth = Number(value ?? 0);
            if (
              !Number.isFinite(strokeWidth) ||
              strokeWidth < 0 ||
              strokeWidth === object.strokeWidth
            ) {
              return;
            }
            patchObject((current) => ({
              ...current,
              strokeWidth,
            }));
          }}
          step={0.25}
          type="number"
          value={object.strokeWidth}
        />
      ) : null}
      {object.fontFamily ? (
        <Select
          onValueChange={(value) => {
            const fontFamily = fontFamilyFromSelect(value ?? "sans");
            if (fontFamily === object.fontFamily) {
              return;
            }
            patchObject((current) => ({
              ...current,
              fontFamily,
            }));
          }}
          value={object.fontFamily}
          items={FONT_FAMILIES}
        >
          <SelectTrigger aria-label="Font family" className="w-32">
            <SelectValue placeholder="Select a font family" />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map(({ label, value }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {object.fontSize === undefined ? null : (
        <Input
          aria-label="Font size"
          className="w-18"
          min={4}
          onValueChange={(value) => {
            const fontSize = Number(value ?? 4);
            if (!Number.isFinite(fontSize) || fontSize === object.fontSize) {
              return;
            }
            patchObject((current) => ({ ...current, fontSize }));
          }}
          type="number"
          // The store keeps full precision; the field shows two decimals.
          value={roundFontSize(object.fontSize)}
        />
      )}
      {glyphMessage ? (
        <p className="text-muted-foreground text-xs">{glyphMessage}</p>
      ) : null}
      {!figmaRun &&
      isPdfTextDirty(object) &&
      object.reusableFontGlyphs !== undefined &&
      !embeddedFontCanDraw(object, object.text) ? (
        <p className="text-muted-foreground text-xs">
          Original font can&apos;t draw these characters; using a substitute.
        </p>
      ) : null}
      {isPdfTextDirty(object) && !pdfTextRemovable(object, page) ? (
        <p className="text-muted-foreground text-xs">
          Old text can only be covered here, so it stays in the file and other
          PDF tools can still find it.
        </p>
      ) : null}
      {object.coverColorUncertain ? (
        <p className="text-muted-foreground text-xs">
          The page behind this text is not one color, so the patch may show.
        </p>
      ) : null}
    </div>
  );
};
