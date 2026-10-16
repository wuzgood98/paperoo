import type { FontFamily } from "@/lib/editor/types";

export const FONT_FAMILIES: { label: string; value: FontFamily }[] = [
  { label: "Sans", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Mono", value: "mono" },
];

export const fontFamilyFromSelect = (value: string): FontFamily => {
  if (value === "serif" || value === "mono") {
    return value;
  }
  return "sans";
};

const FONT_SIZE_STEPS_PER_POINT = 100;

/** Font size as the inspector shows it: two decimals, full precision kept in the store. */
export const roundFontSize = (size: number): number =>
  Math.round(size * FONT_SIZE_STEPS_PER_POINT) / FONT_SIZE_STEPS_PER_POINT;
