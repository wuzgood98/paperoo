import type { EditorPage } from "@/lib/editor/types";
import { classifyPageForOcr } from "@/lib/ocr/classify-page";
import type { OcrService } from "@/lib/ocr/service";
import type { OcrImage, OcrTextObject } from "@/lib/ocr/types";

export type OcrRunStatus = "idle" | "preparing" | "recognizing";

export interface OcrControllerState {
  error: string | null;
  pageCount: number;
  pageNumber: number | null;
  runningPageId: string | null;
  status: OcrRunStatus;
  wordsByPage: Readonly<Record<string, readonly OcrTextObject[]>>;
}

export interface OcrEnqueueOptions {
  language?: string;
  pageCount: number;
  pageNumber: number;
}

export interface OcrControllerDeps {
  createService: () => OcrService;
  renderPage: (page: EditorPage) => Promise<{ image: OcrImage; scale: number }>;
}

const DEFAULT_LANGUAGE = "eng";

const idleState = (): OcrControllerState => ({
  error: null,
  pageCount: 0,
  pageNumber: null,
  runningPageId: null,
  status: "idle",
  wordsByPage: {},
});

export const createOcrController = (deps: OcrControllerDeps) => {
  const listeners = new Set<() => void>();
  let state = idleState();
  let generation = 0;
  let service: OcrService | null = null;
  let busy = false;
  const skipped = new Set<string>();
  const queue: { options: OcrEnqueueOptions; page: EditorPage }[] = [];

  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (partial: Partial<OcrControllerState>): void => {
    // Tesseract reports progress many times per page; only a real change
    // should re-render subscribers.
    const changed =
      // SAFETY: `partial` is a Partial<OcrControllerState>, so its own keys
      // are state keys.
      (Object.keys(partial) as (keyof OcrControllerState)[]).some(
        (key) => !Object.is(partial[key], state[key])
      );
    if (!changed) {
      return;
    }
    state = { ...state, ...partial };
    emit();
  };

  const ensureService = (): OcrService => {
    service ??= deps.createService();
    return service;
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
    const { page, options } = job;
    setState({
      error: null,
      pageCount: options.pageCount,
      pageNumber: options.pageNumber,
      runningPageId: page.id,
      status: "preparing",
    });
    try {
      const rendered = await deps.renderPage(page);
      if (token !== generation) {
        return;
      }
      setState({ status: "recognizing" });
      const result = await ensureService().recognize(
        rendered.image,
        {
          language: options.language ?? DEFAULT_LANGUAGE,
          pageId: page.id,
          scale: rendered.scale,
        },
        (progress) => {
          if (token !== generation) {
            return;
          }
          if (progress.status.includes("recognizing")) {
            setState({ status: "recognizing" });
          }
        }
      );
      if (token !== generation) {
        return;
      }
      setState({
        error: null,
        runningPageId: null,
        status: "idle",
        wordsByPage: { ...state.wordsByPage, [page.id]: result.words },
      });
    } catch (error) {
      if (token !== generation) {
        return;
      }
      setState({
        error: error instanceof Error ? error.message : "OCR failed.",
        runningPageId: null,
        status: "idle",
      });
    } finally {
      busy = false;
      if (token === generation) {
        await runNext();
      }
    }
  };

  const enqueuePage = (
    page: EditorPage,
    options: OcrEnqueueOptions,
    force: boolean
  ): void => {
    if (classifyPageForOcr(page) !== "scanned") {
      return;
    }
    if (state.wordsByPage[page.id]) {
      return;
    }
    if (!force && skipped.has(page.id)) {
      return;
    }
    skipped.delete(page.id);
    if (state.runningPageId === page.id) {
      return;
    }
    if (queue.some((job) => job.page.id === page.id)) {
      return;
    }
    queue.push({ options, page });
    void runNext();
  };

  return {
    cancel: async (): Promise<void> => {
      const runningId = state.runningPageId;
      if (runningId) {
        skipped.add(runningId);
      }
      generation += 1;
      queue.length = 0;
      busy = false;
      const active = service;
      service = null;
      setState({
        error: null,
        pageNumber: null,
        runningPageId: null,
        status: "idle",
      });
      await active?.terminate();
    },
    enqueueVisible: (page: EditorPage, options: OcrEnqueueOptions): void => {
      enqueuePage(page, options, false);
    },
    getState: (): OcrControllerState => state,
    /** Bring back words recognized in a restored session. */
    hydrate: (
      wordsByPage: Readonly<Record<string, readonly OcrTextObject[]>>
    ): void => {
      setState({ wordsByPage });
    },
    reset: async (): Promise<void> => {
      generation += 1;
      queue.length = 0;
      busy = false;
      skipped.clear();
      const active = service;
      service = null;
      state = idleState();
      emit();
      await active?.terminate();
    },
    start: (page: EditorPage, options: OcrEnqueueOptions): void => {
      enqueuePage(page, options, true);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    wordsForExport: (): Readonly<Record<string, readonly OcrTextObject[]>> =>
      state.wordsByPage,
  };
};

export type OcrController = ReturnType<typeof createOcrController>;
