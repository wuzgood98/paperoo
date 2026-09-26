"use client";

import { FONT_FAMILIES, fontFamilyFromSelect } from "@/components/editor/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { editorStore } from "@/lib/editor/store";
import type { PdfTextObject } from "@/lib/editor/types";

export const PdfTextInspector = ({ object }: { object: PdfTextObject }) => (
  <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2">
    <Input
      aria-label="PDF text"
      className="min-w-48"
      onChange={(event) => {
        const text = event.currentTarget.value;
        editorStore.patchPdfText((current) => ({ ...current, text }));
      }}
      value={object.text}
    />
    {object.fontFamily ? (
      <Select
        onValueChange={(value) =>
          editorStore.patchPdfText((current) => ({
            ...current,
            fontFamily: fontFamilyFromSelect(value ?? "sans"),
          }))
        }
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
        onValueChange={(value) =>
          editorStore.patchPdfText((current) => ({
            ...current,
            fontSize: Number(value ?? 4),
          }))
        }
        type="number"
        value={object.fontSize}
      />
    )}
  </div>
);
