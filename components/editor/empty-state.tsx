"use client";

import { FileUpIcon } from "lucide-react";
import { useRef, useState } from "react";

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
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossed; count to know when the
  // drag has really left.
  const dragDepth = useRef(0);

  return (
    <Empty
      className="group/drop relative h-full"
      data-dragging={dragging || undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setDragging(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={async (event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        await onFiles(event.dataTransfer.files);
      }}
    >
      <div
        aria-hidden
        className="border-primary/40 pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed opacity-0 transition-opacity duration-150 ease-out group-data-[dragging]/drop:opacity-100"
      />
      <EmptyHeader>
        <div className="transition-[translate,scale] duration-200 ease-out motion-safe:group-data-[dragging]/drop:-translate-y-0.5 motion-safe:group-data-[dragging]/drop:scale-106">
          <EmptyMedia variant="icon">
            <FileUpIcon />
          </EmptyMedia>
        </div>
        <EmptyTitle>
          {errorMessage ? "Could not open that PDF" : "Open a PDF"}
        </EmptyTitle>
        <EmptyDescription>
          {errorMessage ??
            "Drop a file here or choose one from your computer. Edits stay on a layer above the original pages."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
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
      <RestoreSessionBanner />
    </Empty>
  );
};
