export interface OcrImageBbox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface OcrTextObject {
  baselineY: number;
  confidence?: number;
  height: number;
  id: string;
  lineId: string;
  pageId: string;
  source: "ocr";
  text: string;
  type: "ocr-text";
  width: number;
  x: number;
  y: number;
}

export interface OcrResult {
  words: OcrTextObject[];
}

export interface OcrOptions {
  language: string;
  pageId: string;
  scale: number;
}

export interface OcrProgress {
  progress: number;
  status: string;
}

export type OcrImage = Blob | HTMLCanvasElement | OffscreenCanvas;
