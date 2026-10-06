const OCR_DPI = 150;
const PDF_USER_UNITS_PER_INCH = 72;
const OCR_MAX_LONG_EDGE = 1800;

export const ocrRenderScale = (
  displayedWidth: number,
  displayedHeight: number
): number => {
  const base = OCR_DPI / PDF_USER_UNITS_PER_INCH;
  const longEdge = Math.max(displayedWidth, displayedHeight) * base;
  if (longEdge <= OCR_MAX_LONG_EDGE) {
    return base;
  }
  return base * (OCR_MAX_LONG_EDGE / longEdge);
};
