"use client";

import {
  DownloadIcon,
  EllipsisVerticalIcon,
  FileUpIcon,
  PrinterIcon,
  Redo2Icon,
  SearchIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { DocumentSearch } from "@/components/editor/document-search";
import { PageSheetButton } from "@/components/editor/page-sidebar";
import { ToolbarTip } from "@/components/editor/toolbar-tip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Separator } from "@/components/ui/separator";
import { toastManager } from "@/components/ui/toast-manager";
import { Toggle } from "@/components/ui/toggle";
import {
  editorStore,
  useCanRedo,
  useCanUndo,
  useEditorStore,
} from "@/lib/editor/store";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "@/lib/editor/types";
import { useOcrSession } from "@/lib/ocr/session";
import { openPdfFromList } from "@/lib/pdf/open-pdf";
import { runExport } from "@/lib/pdf/run-export";
import { runPrint } from "@/lib/pdf/run-print";

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

const printPdf = async () => {
  try {
    await runPrint();
  } catch (error) {
    toastManager.add({
      description: error instanceof Error ? error.message : "Print failed.",
      title: "Print failed",
      type: "error",
    });
  }
};

const SearchSheetButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        pressable
        aria-label="Search document"
        className="md:hidden"
        onClick={() => setOpen(true)}
        size="icon-sm"
        variant="ghost"
      >
        <SearchIcon />
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <DocumentSearch
              className="w-full max-w-none min-w-0"
              onGoToHit={() => setOpen(false)}
            />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
};

export const EditorToolbar = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = useEditorStore((state) => state.fileName);
  const status = useEditorStore((state) => state.status);
  const zoom = useEditorStore((state) => state.zoom);
  const zoomMode = useEditorStore((state) => state.zoomMode);
  const isExporting = useEditorStore((state) => state.isExporting);
  const showOcrRegions = useEditorStore((state) => state.showOcrRegions);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const ready = status === "ready";
  const ocr = useOcrSession();
  const hasOcrWords = Object.values(ocr.wordsByPage).some(
    (words) => words.length > 0
  );

  return (
    <header className="border-border flex h-12 shrink-0 items-center gap-1 border-b px-2 md:gap-2 md:px-3">
      <div className="flex min-w-0 items-center gap-2 pr-2">
        <LogoMark className="size-5 shrink-0" />
        <span className="hidden text-sm font-semibold tracking-tight md:inline">
          Paperoo
        </span>
        <span className="text-muted-foreground min-w-0 truncate text-xs md:max-w-56">
          {fileName ?? "Untitled"}
        </span>
      </div>
      <Separator className="hidden md:block" orientation="vertical" />
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
      <ToolbarTip label="Open PDF" shortcut="⌘O">
        <Button
          pressable
          aria-label="Open PDF"
          onClick={() => inputRef.current?.click()}
          size="icon-sm"
          variant="ghost"
        >
          <FileUpIcon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Undo" shortcut="⌘Z">
        <Button
          pressable
          disabled={!ready || !canUndo}
          onClick={() => editorStore.undo()}
          size="icon-sm"
          variant="ghost"
          aria-label="Undo"
        >
          <Undo2Icon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Redo" shortcut="⇧⌘Z">
        <Button
          pressable
          disabled={!ready || !canRedo}
          onClick={() => editorStore.redo()}
          size="icon-sm"
          variant="ghost"
          aria-label="Redo"
        >
          <Redo2Icon />
        </Button>
      </ToolbarTip>
      <div className="hidden items-center gap-2 md:flex">
        <Separator orientation="vertical" />
        <ToolbarTip label="Zoom out">
          <Button
            pressable
            disabled={!ready || zoom <= MIN_ZOOM}
            onClick={() => editorStore.zoomBy(-ZOOM_STEP)}
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom out"
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
            disabled={!ready || zoom >= MAX_ZOOM}
            onClick={() => editorStore.zoomBy(ZOOM_STEP)}
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom in"
          >
            <ZoomInIcon />
          </Button>
        </ToolbarTip>
        <Toggle
          pressable
          disabled={!ready}
          onPressedChange={() => editorStore.fitPage()}
          pressed={zoomMode === "fit-page"}
          size="sm"
          aria-label="Fit page"
        >
          Fit
        </Toggle>
        <Toggle
          pressable
          disabled={!ready}
          onPressedChange={() => editorStore.fitWidth()}
          pressed={zoomMode === "fit-width"}
          size="sm"
          aria-label="Fit width"
        >
          Width
        </Toggle>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <PageSheetButton />
        {ready ? (
          <>
            <div className="hidden md:block">
              <DocumentSearch />
            </div>
            <SearchSheetButton />
          </>
        ) : null}
        {hasOcrWords ? (
          <Toggle
            aria-label="Show OCR regions"
            className="hidden md:inline-flex"
            disabled={!ready}
            onPressedChange={(pressed) => {
              editorStore.setShowOcrRegions(pressed);
            }}
            pressable
            pressed={showOcrRegions}
            size="sm"
          >
            Show OCR regions
          </Toggle>
        ) : null}
        <ToolbarTip label="Print" shortcut="⌘P">
          <Button
            pressable
            aria-label="Print"
            className="hidden md:inline-flex"
            disabled={!ready || isExporting}
            onClick={async () => {
              await printPdf();
            }}
            size="icon-sm"
            variant="ghost"
          >
            <PrinterIcon />
          </Button>
        </ToolbarTip>
        <ToolbarTip label="Export PDF">
          <Button
            pressable
            aria-label="Export PDF"
            className="hidden md:inline-flex"
            disabled={!ready || isExporting}
            onClick={async () => {
              await exportPdf();
            }}
            size="icon-sm"
            variant="default"
          >
            <DownloadIcon />
          </Button>
        </ToolbarTip>
        <Menu>
          <MenuTrigger
            className="md:hidden"
            disabled={!ready}
            render={
              <Button
                pressable
                aria-label="More"
                disabled={!ready}
                size="icon-sm"
                variant="ghost"
              >
                <EllipsisVerticalIcon />
              </Button>
            }
          />
          <MenuPopup align="end">
            <MenuRadioGroup
              onValueChange={(value) => {
                if (value === "fit-page") {
                  editorStore.fitPage();
                  return;
                }
                if (value === "fit-width") {
                  editorStore.fitWidth();
                }
              }}
              value={zoomMode}
            >
              <MenuRadioItem value="fit-page">Fit</MenuRadioItem>
              <MenuRadioItem value="fit-width">Width</MenuRadioItem>
            </MenuRadioGroup>
            {hasOcrWords ? (
              <MenuCheckboxItem
                checked={showOcrRegions}
                onCheckedChange={(checked) => {
                  editorStore.setShowOcrRegions(checked);
                }}
              >
                Show OCR regions
              </MenuCheckboxItem>
            ) : null}
            <MenuSeparator />
            <MenuItem
              disabled={isExporting}
              onClick={async () => {
                await printPdf();
              }}
            >
              <PrinterIcon />
              Print
            </MenuItem>
            <MenuItem
              disabled={isExporting}
              onClick={async () => {
                await exportPdf();
              }}
            >
              <DownloadIcon />
              Export PDF
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </header>
  );
};
