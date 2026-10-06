"use client";

import { useMemo, useState } from "react";

import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { DocumentSearchHit } from "@/lib/ocr/search";
import { searchDocumentText } from "@/lib/ocr/search";
import { useOcrSession } from "@/lib/ocr/session";

const hitValue = (hit: DocumentSearchHit): string =>
  `${hit.pageId}:${hit.objectId}`;

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
    <div className="max-w-56 min-w-40">
      <Autocomplete
        autoHighlight
        itemToStringLabel={(hit) => hit.text}
        items={hits}
        mode="none"
        onOpenChange={setOpen}
        onValueChange={(value) => {
          setQuery(value);
          setOpen(true);
        }}
        open={open && query.trim().length > 0}
        value={query}
      >
        <AutocompleteInput
          aria-label="Search document"
          placeholder="Search"
          showClear
          showTrigger={false}
          size="sm"
        />
        <AutocompletePopup className="w-72">
          <AutocompleteEmpty>No matches</AutocompleteEmpty>
          <AutocompleteList>
            {(hit) => (
              <AutocompleteItem
                key={hitValue(hit)}
                onClick={() => {
                  goToSearchHit(hit);
                  setOpen(false);
                }}
                value={hit}
              >
                <span className="block truncate">{hit.text}</span>
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>
    </div>
  );
};
