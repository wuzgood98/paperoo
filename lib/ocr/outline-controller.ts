import type {
  EditorPage,
  PdfTextObject,
  PdfVectorObject,
} from "@/lib/editor/types";
import {
  outlineLinesFromEngine,
  outlineRasterFrame,
} from "@/lib/ocr/outline-ocr";
import type { OutlineRasterFrame } from "@/lib/ocr/outline-ocr";
import { outlineTextRuns } from "@/lib/ocr/outline-runs";
import {
  isOutlineTextCandidateOn,
  recognizeOutlineLines,
} from "@/lib/ocr/outline-text";
import type { OcrEngine } from "@/lib/ocr/service";
import type { OcrImage } from "@/lib/ocr/types";

export interface OutlineTextControllerDeps {
  /** Store the runs for a label; the vector becomes their ink. */
  apply: (pageId: string, vectorId: string, runs: PdfTextObject[]) => void;
  createEngine: () => OcrEngine;
  getPages: () => readonly EditorPage[];
  /** A label the user clicked failed to recognize. */
  onError?: (message: string) => void;
  render: (vector: PdfVectorObject, frame: OutlineRasterFrame) => OcrImage;
}

interface Job {
  pageId: string;
  /** The user clicked it: errors are reported. */
  urgent: boolean;
  vectorId: string;
}

const LANGUAGE = "eng";

/**
 * Recognizes outline-only text one label at a time, in the background.
 * Each candidate path is tried once per document; a click moves its label
 * to the front of the queue.
 */
export const createOutlineTextController = (
  deps: OutlineTextControllerDeps
) => {
  let engine: OcrEngine | null = null;
  let generation = 0;
  let busy = false;
  const queue: Job[] = [];
  /** Vector ids already tried or queued. */
  const seen = new Set<string>();

  const findVector = (
    job: Job
  ): { page: EditorPage; vector: PdfVectorObject } | null => {
    const page = deps.getPages().find((item) => item.id === job.pageId);
    const vector = page?.pdfVectorObjects.find(
      (item) => item.id === job.vectorId
    );
    return page && vector && isOutlineTextCandidateOn(page, vector)
      ? { page, vector }
      : null;
  };

  const recognize = async (job: Job, token: number): Promise<void> => {
    const found = findVector(job);
    const frame = found ? outlineRasterFrame(found.vector) : null;
    if (!(found && frame)) {
      return;
    }
    const image = deps.render(found.vector, frame);
    engine ??= deps.createEngine();
    const result = await engine.recognize(image, {
      language: LANGUAGE,
      pageId: job.pageId,
      scale: frame.scale,
    });
    if (token !== generation) {
      return;
    }
    // The page may have changed while OCR ran; use its current state.
    const current = findVector(job);
    if (!current) {
      return;
    }
    const lines = recognizeOutlineLines(
      current.vector,
      outlineLinesFromEngine(result, frame)
    );
    if (!lines) {
      return;
    }
    deps.apply(
      job.pageId,
      job.vectorId,
      outlineTextRuns(deps.getPages(), current.page, current.vector, lines)
    );
  };

  const runNext = async (): Promise<void> => {
    if (busy) {
      return;
    }
    const job = queue.shift();
    if (!job) {
      return;
    }
    busy = true;
    const token = generation;
    try {
      await recognize(job, token);
    } catch (error) {
      if (token === generation && job.urgent) {
        deps.onError?.(
          error instanceof Error ? error.message : "Text recognition failed."
        );
      }
    } finally {
      if (token === generation) {
        busy = false;
        await runNext();
      }
    }
  };

  const enqueue = (page: EditorPage): void => {
    for (const vector of page.pdfVectorObjects) {
      if (seen.has(vector.id) || !isOutlineTextCandidateOn(page, vector)) {
        continue;
      }
      seen.add(vector.id);
      queue.push({ pageId: page.id, urgent: false, vectorId: vector.id });
    }
  };

  return {
    /** Queue every candidate on these pages (a search wants them all). */
    enqueueAll: (pages: readonly EditorPage[]): void => {
      for (const page of pages) {
        enqueue(page);
      }
      void runNext();
    },
    /** Queue a visible page's candidates. */
    enqueuePage: (page: EditorPage): void => {
      enqueue(page);
      void runNext();
    },
    /** Recognize this label next: the user is pointing at it. */
    prioritize: (pageId: string, vectorId: string): void => {
      const index = queue.findIndex((job) => job.vectorId === vectorId);
      if (index !== -1) {
        queue.splice(index, 1);
      } else if (seen.has(vectorId)) {
        return;
      }
      seen.add(vectorId);
      queue.unshift({ pageId, urgent: true, vectorId });
      void runNext();
    },
    reset: async (): Promise<void> => {
      generation += 1;
      queue.length = 0;
      seen.clear();
      busy = false;
      const active = engine;
      engine = null;
      await active?.terminate?.();
    },
  };
};

export type OutlineTextController = ReturnType<
  typeof createOutlineTextController
>;
