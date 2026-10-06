"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { DocumentSearchHit } from "@/lib/ocr/search";
import { searchDocumentText } from "@/lib/ocr/search";
import { useOcrSession } from "@/lib/ocr/session";

const SEARCH_RESULTS_BLUR_CLOSE_MS = 120;

const goToSearchHit = (hit: DocumentSearchHit): void => {
  editorStore.setCurrentPage(hit.pageId, { syncFitZoom: false });
  if (hit.source === "native") {
    editorStore.selectPdfText(hit.objectId);
    return;
  }
  if (hit.source === "overlay") {
    editorStore.selectObjects([hit.objectId]);
    return;
  }
  editorStore.selectOcrWords([hit.objectId]);
};

export const DocumentSearch = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const ocr = useOcrSession();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(
    () => searchDocumentText(pages, ocr.wordsByPage, query),
    [ocr.wordsByPage, pages, query]
  );

  return (
    <div className="relative max-w-56 min-w-40">
      <Input
        aria-label="Search document"
        nativeInput
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
          }, SEARCH_RESULTS_BLUR_CLOSE_MS);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        placeholder="Search"
        size="sm"
        type="search"
        value={query}
      />
      {open && query.trim().length > 0 ? (
        <div className="bg-background absolute top-full z-20 mt-1 max-h-64 w-72 overflow-auto rounded-lg border py-1 shadow-md">
          {hits.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-xs">
              No matches
            </p>
          ) : (
            hits.map((hit) => (
              <button
                className="hover:bg-accent block w-full truncate px-3 py-1.5 text-left text-xs"
                key={`${hit.pageId}:${hit.objectId}`}
                onClick={() => {
                  goToSearchHit(hit);
                  setOpen(false);
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                type="button"
              >
                {hit.text}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
};
