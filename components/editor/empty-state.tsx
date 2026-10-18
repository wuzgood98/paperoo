"use client";

import { FileUpIcon } from "lucide-react";
import { useRef } from "react";

import { RestoreSessionBanner } from "@/components/editor/restore-session-banner";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { useEditorStore } from "@/lib/editor/store";
import {
  openPdfFromList,
  openPdfFromUrl,
  prewarmPdfOpen,
} from "@/lib/pdf/open-pdf";

const onFiles = async (files: FileList | null) => {
  await openPdfFromList(files);
};

export const EmptyState = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorMessage = useEditorStore((state) => state.errorMessage);

  return (
    <Empty
      className="h-full"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={async (event) => {
        event.preventDefault();
        await onFiles(event.dataTransfer.files);
      }}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileUpIcon />
        </EmptyMedia>
        <EmptyTitle>
          {errorMessage ? "Could not open that PDF" : "Open a PDF"}
        </EmptyTitle>
        <EmptyDescription>
          {errorMessage ??
            "Drop a file here or choose one from your computer. Edits stay on a layer above the original pages."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <RestoreSessionBanner />
        <input
          accept="application/pdf"
          className="sr-only"
          onChange={async (event) => {
            await onFiles(event.target.files);
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
        <div className="flex items-center justify-center gap-2">
          <Button
            pressable
            onClick={() => inputRef.current?.click()}
            onFocus={prewarmPdfOpen}
            onPointerEnter={prewarmPdfOpen}
          >
            Choose PDF
          </Button>
          <Button
            pressable
            onClick={async () => {
              await openPdfFromUrl("/sample.pdf", "sample.pdf");
            }}
            onFocus={prewarmPdfOpen}
            onPointerEnter={prewarmPdfOpen}
            variant="outline"
          >
            Open sample
          </Button>
        </div>
        <p className="text-muted-foreground hidden items-center justify-center gap-1.5 text-xs md:flex">
          Open
          <Kbd>⌘O</Kbd>· Undo
          <Kbd>⌘Z</Kbd>
        </p>
      </EmptyContent>
    </Empty>
  );
};
