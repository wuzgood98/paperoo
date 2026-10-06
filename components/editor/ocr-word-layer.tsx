"use client";

import { useEffect } from "react";

import { objectWrapperStyle } from "@/lib/editor/coordinates";
import { visibleOcrWords } from "@/lib/ocr/hit";
import type { OcrTextObject } from "@/lib/ocr/types";
import { cn } from "@/lib/utils";

export const OcrWordLayer = ({
  hoveredId,
  selectedIds,
  showRegions,
  suppressedIds,
  words,
  zoom,
}: {
  hoveredId: string | null;
  selectedIds: ReadonlySet<string>;
  showRegions: boolean;
  suppressedIds: readonly string[] | undefined;
  words: readonly OcrTextObject[];
  zoom: number;
}) => {
  const visible = visibleOcrWords(words, suppressedIds);
  const selectedKey = [...selectedIds].join("\0");

  useEffect(() => {
    const [wordId] = selectedKey.split("\0");
    if (!wordId) {
      return;
    }
    const node = document.querySelector(
      `[data-ocr-word-id="${CSS.escape(wordId)}"]`
    );
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  if (visible.length === 0) {
    return null;
  }

  return (
    <>
      {visible.map((word) => {
        const selected = selectedIds.has(word.id);
        const hovered = hoveredId === word.id;
        if (!(showRegions || selected || hovered)) {
          return null;
        }
        return (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute origin-center",
              showRegions && "outline-info/70 outline outline-1",
              (selected || hovered) && "bg-info/25"
            )}
            data-ocr-word-id={word.id}
            key={word.id}
            style={objectWrapperStyle({ ...word, rotation: 0 }, zoom)}
          />
        );
      })}
    </>
  );
};
