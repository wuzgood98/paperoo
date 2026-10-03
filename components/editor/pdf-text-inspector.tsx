"use client";

import { ColorField } from "@/components/editor/color-field";
import { FONT_FAMILIES, fontFamilyFromSelect } from "@/components/editor/utils";
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
  pdfTextNeedsFill,
  pdfTextNeedsStroke,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type { PdfTextObject } from "@/lib/editor/types";

export const PdfTextInspector = ({ object }: { object: PdfTextObject }) => {
  const showFill = pdfTextNeedsFill(object.textRenderingMode);
  const showStroke = pdfTextNeedsStroke(object.textRenderingMode);

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2">
      {showFill ? (
        <ColorField
          label="Color"
          onChange={(value) => {
            const color = normalizeHex(value);
            if (color === object.color) {
              return;
            }
            editorStore.patchPdfText((current) => ({ ...current, color }));
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
            editorStore.patchPdfText((current) => ({
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
            editorStore.patchPdfText((current) => ({
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
            editorStore.patchPdfText((current) => ({
              ...current,
              fontFamily,
            }));
          }}
          value={object.fontFamily}
          items={FONT_FAMILIES}
        >
          <SelectTrigger className="w-32">
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
          className="w-18"
          min={4}
          onValueChange={(value) => {
            const fontSize = Number(value ?? 4);
            if (!Number.isFinite(fontSize) || fontSize === object.fontSize) {
              return;
            }
            editorStore.patchPdfText((current) => ({ ...current, fontSize }));
          }}
          type="number"
          value={object.fontSize}
        />
      )}
    </div>
  );
};
