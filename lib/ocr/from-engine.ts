import { DEFAULT_ASCENT_RATIO } from "@/lib/editor/coordinates";
import { createId as defaultCreateId } from "@/lib/editor/ids";
import { ocrImageBoxToDisplayed } from "@/lib/ocr/map-box";
import type { OcrImageBbox, OcrTextObject } from "@/lib/ocr/types";

export interface EngineOcrWord {
  bbox: OcrImageBbox;
  confidence: number;
  text: string;
}

export interface EngineOcrLine {
  baseline?: OcrImageBbox;
  bbox: OcrImageBbox;
  words: EngineOcrWord[];
}

export interface EngineOcrParagraph {
  lines: EngineOcrLine[];
}

export interface EngineOcrBlock {
  paragraphs: EngineOcrParagraph[];
}

export interface EngineOcrPage {
  blocks: EngineOcrBlock[];
}

export interface OcrFromEngineOptions {
  createId?: () => string;
  pageId: string;
  scale: number;
}

const lineBaselineY = (line: EngineOcrLine, scale: number): number => {
  if (line.baseline) {
    return (line.baseline.y0 + line.baseline.y1) / 2 / scale;
  }
  const box = ocrImageBoxToDisplayed(line.bbox, scale);
  return box.y + box.height * DEFAULT_ASCENT_RATIO;
};

export const ocrWordsFromEngine = (
  page: EngineOcrPage,
  options: OcrFromEngineOptions
): OcrTextObject[] => {
  const createId = options.createId ?? defaultCreateId;
  const words: OcrTextObject[] = [];
  for (const block of page.blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const lineId = createId();
        const baselineY = lineBaselineY(line, options.scale);
        for (const word of line.words) {
          const text = word.text.trim();
          if (text.length === 0) {
            continue;
          }
          const box = ocrImageBoxToDisplayed(word.bbox, options.scale);
          words.push({
            baselineY,
            confidence: word.confidence,
            height: box.height,
            id: createId(),
            lineId,
            pageId: options.pageId,
            source: "ocr",
            text,
            type: "ocr-text",
            width: box.width,
            x: box.x,
            y: box.y,
          });
        }
      }
    }
  }
  return words;
};
