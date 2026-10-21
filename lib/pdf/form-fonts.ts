import { Encodings } from "@pdf-lib/standard-fonts";

import { isPdfFormFieldDirty } from "@/lib/editor/object-utils";
import type { PdfFormChoiceOption, PdfFormField } from "@/lib/editor/types";
import { FONT_FILES } from "@/lib/fonts/measure-text";

/**
 * Fonts a field's text falls back to when Helvetica cannot draw it, best
 * coverage first: Inter has Twi (ɔ, ɛ) and the cedi sign (₵); Liberation
 * Sans has neither.
 */
export const FORM_FALLBACK_FONT_URLS = [
  FONT_FILES.inter[400],
  FONT_FILES.sans[400],
] as const;

/** Whether a font can draw this Unicode code point. */
export type GlyphCover = (codePoint: number) => boolean;

/** Helvetica in a form appearance uses WinAnsi, so it draws only those. */
export const helveticaCovers: GlyphCover = (codePoint) =>
  Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint);

/** Line breaks and tabs lay text out; no glyph draws them. */
const LAYOUT_CHARACTERS = new Set(["\n", "\r", "\t"]);

const drawnLetters = (text: string): string[] => [
  ...new Set([...text].filter((letter) => !LAYOUT_CHARACTERS.has(letter))),
];

export const coversText = (cover: GlyphCover, text: string): boolean =>
  drawnLetters(text).every((letter) => cover(letter.codePointAt(0) ?? 0));

/** The letters none of the fonts can draw, each once. */
export const lettersNoFontCovers = (
  text: string,
  covers: readonly GlyphCover[]
): string[] =>
  drawnLetters(text).filter((letter) => {
    const codePoint = letter.codePointAt(0) ?? 0;
    return !covers.some((cover) => cover(codePoint));
  });

const choiceDisplay = (
  options: readonly PdfFormChoiceOption[],
  exportValue: string
): string =>
  options.find((option) => option.exportValue === exportValue)?.display ??
  exportValue;

/** The text a field's appearance draws, in the font chosen for it. */
export const formFieldDrawnText = (field: PdfFormField): string => {
  switch (field.kind) {
    case "text": {
      return field.value;
    }
    case "dropdown": {
      return field.value ? choiceDisplay(field.options, field.value) : "";
    }
    case "listbox": {
      return field.value
        .map((value) => choiceDisplay(field.options, value))
        .join("\n");
    }
    case "radio": {
      return field.value ?? "";
    }
    default: {
      return "";
    }
  }
};

export interface FieldMissingLetters {
  letters: string[];
  name: string;
}

/**
 * Filled fields whose text has letters no font can draw; those letters
 * would show as empty boxes. Unfilled fields keep their own appearance.
 */
export const formFieldsMissingLetters = (
  fields: readonly PdfFormField[],
  covers: readonly GlyphCover[]
): FieldMissingLetters[] =>
  fields.flatMap((field) => {
    if (!isPdfFormFieldDirty(field)) {
      return [];
    }
    const letters = lettersNoFontCovers(formFieldDrawnText(field), covers);
    return letters.length > 0 ? [{ letters, name: field.name }] : [];
  });
