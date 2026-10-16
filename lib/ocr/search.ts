import type { EditorPage } from "@/lib/editor/types";
import { classifyPageForOcr } from "@/lib/ocr/classify-page";
import type { OcrTextObject } from "@/lib/ocr/types";

export type SearchHitSource = "native" | "ocr" | "overlay";

export interface DocumentSearchHit {
  height: number;
  objectId: string;
  pageId: string;
  source: SearchHitSource;
  text: string;
  width: number;
  x: number;
  y: number;
}

const matchesQuery = (text: string, query: string): boolean =>
  text.toLowerCase().includes(query.toLowerCase());

export const searchDocumentText = (
  pages: readonly EditorPage[],
  ocrWordsByPage: Readonly<Record<string, readonly OcrTextObject[]>>,
  query: string
): DocumentSearchHit[] => {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const hits: DocumentSearchHit[] = [];
  for (const page of pages) {
    const kind = classifyPageForOcr(page);
    // Plain pages can still hold outline-only text recognized into runs.
    if (kind !== "scanned") {
      for (const object of page.pdfTextObjects) {
        if (!matchesQuery(object.text, trimmed)) {
          continue;
        }
        hits.push({
          height: object.height,
          objectId: object.id,
          pageId: page.id,
          source: "native",
          text: object.text,
          width: object.width,
          x: object.x,
          y: object.y,
        });
      }
      continue;
    }
    const suppressed = page.suppressedOcrWordIds
      ? new Set(page.suppressedOcrWordIds)
      : null;
    for (const object of page.objects) {
      if (object.type !== "text" || !object.ocrWordId) {
        continue;
      }
      if (!matchesQuery(object.content, trimmed)) {
        continue;
      }
      hits.push({
        height: object.height,
        objectId: object.id,
        pageId: page.id,
        source: "overlay",
        text: object.content,
        width: object.width,
        x: object.x,
        y: object.y,
      });
    }
    for (const word of ocrWordsByPage[page.id] ?? []) {
      if (suppressed?.has(word.id) || !matchesQuery(word.text, trimmed)) {
        continue;
      }
      hits.push({
        height: word.height,
        objectId: word.id,
        pageId: page.id,
        source: "ocr",
        text: word.text,
        width: word.width,
        x: word.x,
        y: word.y,
      });
    }
  }
  return hits;
};
