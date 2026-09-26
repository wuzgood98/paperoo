"use client";

import {
  DownloadIcon,
  FileUpIcon,
  Redo2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { toastManager } from "@/components/ui/toast-manager";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import { ZOOM_STEP } from "@/lib/editor/types";
import { openPdfFromList } from "@/lib/pdf/open-pdf";
import { runExport } from "@/lib/pdf/run-export";

const openFile = async (files: FileList | null) => {
  await openPdfFromList(files);
};

const exportPdf = async () => {
  try {
    await runExport();
    toastManager.add({ title: "Exported PDF", type: "success" });
  } catch (error) {
    toastManager.add({
      description: error instanceof Error ? error.message : "Export failed.",
      title: "Export failed",
      type: "error",
    });
  }
};

export const ToolbarTip = ({
  children,
  label,
  shortcut,
}: {
  children: React.ReactElement;
  label: string;
  shortcut?: string;
}) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipPopup>
      <span className="flex items-center gap-2">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </span>
    </TooltipPopup>
  </Tooltip>
);

export const EditorToolbar = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = useEditorStore((state) => state.fileName);
  const status = useEditorStore((state) => state.status);
  const zoom = useEditorStore((state) => state.zoom);
  const isExporting = useEditorStore((state) => state.isExporting);
  const ready = status === "ready";

  return (
    <header className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="text-sm font-semibold tracking-tight">Paperoo</span>
        <span className="text-muted-foreground hidden max-w-56 truncate text-xs sm:inline">
          {fileName ?? "Untitled"}
        </span>
      </div>
      <Separator orientation="vertical" />
      <input
        accept="application/pdf"
        className="sr-only"
        id="editor-open-input"
        onChange={async (event) => {
          await openFile(event.target.files);
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      <ToolbarTip label="Open PDF">
        <Button
          pressable
          onClick={() => inputRef.current?.click()}
          size="sm"
          variant="outline"
        >
          <FileUpIcon />
          Open
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Undo" shortcut="⌘Z">
        <Button
          pressable
          disabled={!ready}
          onClick={() => editorStore.undo()}
          size="icon-sm"
          variant="ghost"
        >
          <Undo2Icon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Redo" shortcut="⇧⌘Z">
        <Button
          pressable
          disabled={!ready}
          onClick={() => editorStore.redo()}
          size="icon-sm"
          variant="ghost"
        >
          <Redo2Icon />
        </Button>
      </ToolbarTip>
      <Separator orientation="vertical" />
      <ToolbarTip label="Zoom out">
        <Button
          pressable
          disabled={!ready}
          onClick={() => editorStore.zoomBy(-ZOOM_STEP)}
          size="icon-sm"
          variant="ghost"
        >
          <ZoomOutIcon />
        </Button>
      </ToolbarTip>
      <span className="text-muted-foreground min-w-12 text-center text-xs tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <ToolbarTip label="Zoom in">
        <Button
          pressable
          disabled={!ready}
          onClick={() => editorStore.zoomBy(ZOOM_STEP)}
          size="icon-sm"
          variant="ghost"
        >
          <ZoomInIcon />
        </Button>
      </ToolbarTip>
      <Button
        pressable
        disabled={!ready}
        onClick={() => editorStore.fitPage()}
        size="xs"
        variant="ghost"
      >
        Fit
      </Button>
      <Button
        pressable
        disabled={!ready}
        onClick={() => editorStore.fitWidth()}
        size="xs"
        variant="ghost"
      >
        Width
      </Button>
      <div className="ml-auto">
        <Button
          pressable
          disabled={!ready || isExporting}
          loading={isExporting}
          onClick={async () => {
            await exportPdf();
          }}
          size="sm"
        >
          <DownloadIcon />
          Export PDF
        </Button>
      </div>
    </header>
  );
};
