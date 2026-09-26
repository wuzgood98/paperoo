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
