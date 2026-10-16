import type { EditorPage } from "@/lib/editor/types";

export type OcrPageKind = "native" | "scanned" | "plain";

const MIN_NATIVE_TEXT_CHARS = 40;
const MIN_SCAN_IMAGE_COVERAGE = 0.45;

/** Text the PDF itself carries; recognized outline text does not count. */
const pageTextLength = (page: EditorPage): number => {
  let text = "";
  for (const object of page.pdfTextObjects) {
    if (!object.outlineText) {
      text += object.text;
    }
  }
  return text.trim().length;
};

const pageArea = (page: EditorPage): number =>
  Math.max(page.width, 1) * Math.max(page.height, 1);

const maxImageCoverage = (page: EditorPage): number => {
  const area = pageArea(page);
  let max = 0;
  for (const image of page.pdfImageObjects) {
    if (image.deleted) {
      continue;
    }
    max = Math.max(max, (image.width * image.height) / area);
  }
  return max;
};

export const classifyPageForOcr = (page: EditorPage): OcrPageKind => {
  if (pageTextLength(page) >= MIN_NATIVE_TEXT_CHARS) {
    return "native";
  }
  if (maxImageCoverage(page) >= MIN_SCAN_IMAGE_COVERAGE) {
    return "scanned";
  }
  return "plain";
};
