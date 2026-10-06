import { createTextObject } from "@/lib/editor/object-utils";
import type { TextObject } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";

export const MIN_OCR_EDIT_FONT_SIZE = 1;
export const MIN_OCR_EDIT_HEIGHT = 1;
export const MIN_OCR_EDIT_WIDTH = 8;

export const textObjectFromOcrWord = (word: OcrTextObject): TextObject =>
  createTextObject(
    { x: word.x, y: word.y },
    {
      content: word.text,
      fontSize: Math.max(word.height, MIN_OCR_EDIT_FONT_SIZE),
      height: Math.max(word.height, MIN_OCR_EDIT_HEIGHT),
      ocrWordId: word.id,
      width: Math.max(word.width, MIN_OCR_EDIT_WIDTH),
    }
  );
