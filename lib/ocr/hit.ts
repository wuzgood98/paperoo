import type { Point } from "@/lib/editor/types";
import type { OcrTextObject } from "@/lib/ocr/types";

const pointInWord = (point: Point, word: OcrTextObject): boolean =>
  point.x >= word.x &&
  point.x <= word.x + word.width &&
  point.y >= word.y &&
  point.y <= word.y + word.height;

export const visibleOcrWords = (
  words: readonly OcrTextObject[],
  suppressedIds: readonly string[] | undefined
): readonly OcrTextObject[] => {
  // Hover hit-tests call this every frame; don't copy when nothing is hidden.
  if (!suppressedIds || suppressedIds.length === 0) {
    return words;
  }
  const skipped = new Set(suppressedIds);
  return words.filter((word) => !skipped.has(word.id));
};

export const hitTestOcrWord = (
  words: readonly OcrTextObject[],
  point: Point
): OcrTextObject | undefined => {
  // Topmost first, without copying the list per pointer move.
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word && pointInWord(point, word)) {
      return word;
    }
  }
  return undefined;
};

export const ocrWordRangeIds = (
  words: readonly OcrTextObject[],
  fromId: string,
  toId: string
): readonly string[] => {
  const start = words.findIndex((word) => word.id === fromId);
  const end = words.findIndex((word) => word.id === toId);
  if (start === -1 && end === -1) {
    return [];
  }
  if (start === -1) {
    return [toId];
  }
  if (end === -1) {
    return [fromId];
  }
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return words.slice(low, high + 1).map((word) => word.id);
};
