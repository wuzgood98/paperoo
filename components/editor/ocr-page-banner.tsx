"use client";

import { Button } from "@/components/ui/button";
import type { EditorPage } from "@/lib/editor/types";
import { classifyPageForOcr } from "@/lib/ocr/classify-page";
import { ocrDocumentProgressLabel, ocrStatusLabel } from "@/lib/ocr/progress";
import { ocrSession, useOcrSession } from "@/lib/ocr/session";

export const OcrPageBanner = ({
  page,
  pageCount,
  pageNumber,
}: {
  page: EditorPage;
  pageCount: number;
  pageNumber: number;
}) => {
  const ocr = useOcrSession();
  if (classifyPageForOcr(page) !== "scanned") {
    return null;
  }
  const cached = ocr.wordsByPage[page.id];
  const runningHere = ocr.runningPageId === page.id;
  if (cached !== undefined && !runningHere) {
    return null;
  }
  const status = runningHere ? ocrStatusLabel(ocr) : null;
  const progress = runningHere ? ocrDocumentProgressLabel(ocr) : null;

  return (
    <div className="bg-background/95 pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-sm">
      {runningHere ? (
        <>
          <span>{status}</span>
          {progress ? (
            <span className="text-muted-foreground">{progress}</span>
          ) : null}
          <Button
            onClick={() => {
              void ocrSession.cancel();
            }}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span>Scanned page — OCR available</span>
          <Button
            onClick={() => {
              ocrSession.start(page, { pageCount, pageNumber });
            }}
            size="sm"
            variant="outline"
          >
            Start OCR
          </Button>
        </>
      )}
    </div>
  );
};
