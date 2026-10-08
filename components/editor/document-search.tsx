"use client";

import { useMemo, useState } from "react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { createComboboxItems } from "@/components/ui/combobox-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { DocumentSearchHit } from "@/lib/ocr/search";
import { searchDocumentText } from "@/lib/ocr/search";
import { useOcrSession } from "@/lib/ocr/session";
import { cn } from "@/lib/utils";

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

export const DocumentSearch = ({
  className,
  onGoToHit,
}: {
  className?: string;
  onGoToHit?: () => void;
}) => {
  const pages = useEditorStore((state) => state.document.pages);
  const ocr = useOcrSession();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(
    () => searchDocumentText(pages, ocr.wordsByPage, query),
    [ocr.wordsByPage, pages, query]
  );
  const items = useMemo(
    () =>
      createComboboxItems(hits, {
        getLabel: (hit) => hit.text,
        getValue: hitValue,
      }),
    [hits]
  );

  return (
    <div className={cn("max-w-56 min-w-40", className)}>
      <Combobox
        autoHighlight
        filter={null}
        inputValue={query}
        items={items}
        onInputValueChange={(value) => {
          setQuery(value);
          setOpen(true);
        }}
        onOpenChange={setOpen}
        onValueChange={(value) => {
          const hit = hits.find((item) => hitValue(item) === value);
          if (hit) {
            goToSearchHit(hit);
            onGoToHit?.();
          }
        }}
        open={open && query.trim().length > 0}
      >
        <ComboboxInput
          aria-label="Search document"
          placeholder="Search"
          showClear
          showTrigger={false}
          size="sm"
        />
        <ComboboxPopup className="w-72 max-w-[min(18rem,calc(100vw-2rem))]">
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(hit) => (
              <ComboboxItem key={hitValue(hit)} value={hitValue(hit)}>
                <span className="block truncate">{hit.text}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
};
