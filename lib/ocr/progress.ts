import type { OcrRunStatus } from "@/lib/ocr/controller";

export const ocrPreparingText = (pageNumber: number): string =>
  `Preparing page ${pageNumber}...`;

export const OCR_RECOGNIZING_TEXT = "Recognizing text...";

export const ocrPageOfDocumentText = (
  pageNumber: number,
  pageCount: number
): string => `Page ${pageNumber} of ${pageCount}`;

export const ocrStatusLabel = (input: {
  pageCount: number;
  pageNumber: number | null;
  status: OcrRunStatus;
}): string | null => {
  if (input.status === "idle" || input.pageNumber === null) {
    return null;
  }
  if (input.status === "preparing") {
    return ocrPreparingText(input.pageNumber);
  }
  return OCR_RECOGNIZING_TEXT;
};

export const ocrDocumentProgressLabel = (input: {
  pageCount: number;
  pageNumber: number | null;
  status: OcrRunStatus;
}): string | null => {
  if (input.status === "idle" || input.pageNumber === null) {
    return null;
  }
  return ocrPageOfDocumentText(input.pageNumber, input.pageCount);
};
