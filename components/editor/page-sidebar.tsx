"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  FileOutputIcon,
  ListChecksIcon,
  FileInputIcon,
  FilePlusIcon,
  PlusIcon,
  RotateCwIcon,
  SquareStackIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { exportPdfWithToast } from "@/components/editor/export-action";
import {
  setPageSelectMode,
  usePageSelectMode,
} from "@/components/editor/page-select-mode";
import { ToolbarTip } from "@/components/editor/toolbar-tip";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toastManager } from "@/components/ui/toast-manager";
import { pdfFormWidgetsOnPage } from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type { EditorPage } from "@/lib/editor/types";
import { cn } from "@/lib/utils";

// Thumbnails render through pdf.js; only load it once a document is open.
const PageThumbnail = dynamic(
  async () => {
    const thumbnail = await import("@/components/editor/page-thumbnail");
    return thumbnail.PageThumbnail;
  },
  {
    loading: () => (
      <div className="bg-muted border-border overflow-hidden rounded-md border shadow-xs" />
    ),
    ssr: false,
  }
);

// Page insertion opens pdf.js sources; load it only when a page is added.
const loadPageActions = () => import("@/lib/editor/page-actions");

const PAGES_LOADING = "Wait for every page to load, then try again.";

const duplicatePageWithNotice = async (pageId: string): Promise<void> => {
  const { duplicatePage } = await loadPageActions();
  const hasFields =
    pdfFormWidgetsOnPage(editorStore.getState().document, pageId).length > 0;
  if (!duplicatePage(pageId)) {
    toastManager.add({ title: PAGES_LOADING, type: "info" });
    return;
  }
  if (hasFields) {
    toastManager.add({
      description: "The copy keeps the page's content but not its form fields.",
      title: "Form fields aren't duplicated",
      type: "info",
    });
  }
};

const insertBlankPageWithNotice = async (pageId: string): Promise<void> => {
  const { insertBlankPageAfter } = await loadPageActions();
  try {
    if (!(await insertBlankPageAfter(pageId))) {
      toastManager.add({ title: PAGES_LOADING, type: "info" });
    }
  } catch (error) {
    toastManager.add({
      description:
        error instanceof Error ? error.message : "Could not add a page.",
      title: "Page not added",
      type: "error",
    });
  }
};

// Inserting a PDF parses it with pdf.js; load that code on first use.
const loadInsertPdf = () => import("@/lib/pdf/insert-pdf");

/** Insert a PDF file's pages before position `atIndex` and say how it went. */
const insertPdfWithNotice = async (
  file: File,
  atIndex: number
): Promise<void> => {
  const { insertPdfFile } = await loadInsertPdf();
  try {
    const count = await insertPdfFile(file, atIndex);
    toastManager.add({
      description: file.name,
      title: count === 1 ? "Inserted 1 page" : `Inserted ${count} pages`,
      type: "success",
    });
  } catch (error) {
    toastManager.add({
      description:
        error instanceof Error ? error.message : "Could not insert that PDF.",
      title: "Pages not inserted",
      type: "error",
    });
  }
};

/** Index right after `pageId`, or the end when it is not found. */
const indexAfter = (pageId: string): number => {
  const { pages } = editorStore.getState().document;
  const index = pages.findIndex((page) => page.id === pageId);
  return index === -1 ? pages.length : index + 1;
};

const firstPdf = (files: FileList | null | undefined): File | null =>
  [...(files ?? [])].find(
    (file) => !file.type || file.type === "application/pdf"
  ) ?? null;

const deletePage = (pageId: string): void => {
  const next = editorStore
    .getState()
    .document.pages.filter((page) => page.id !== pageId);
  if (next.length > 0) {
    editorStore.setPages(next);
  }
};

const AddPageMenu = ({ pageId }: { pageId: string | null }) => {
  const hydrated = useEditorStore((state) => state.hydrated);
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = !(hydrated && pageId);
  return (
    <Menu>
      <input
        accept="application/pdf"
        aria-hidden
        className="sr-only"
        onChange={async (event) => {
          const file = firstPdf(event.target.files);
          event.target.value = "";
          if (file && pageId) {
            await insertPdfWithNotice(file, indexAfter(pageId));
          }
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <ToolbarTip label={hydrated ? "Add page" : "Pages are still loading"}>
        <MenuTrigger
          aria-label="Add page"
          disabled={disabled}
          render={
            <Button
              pressable
              disabled={disabled}
              size="icon-xs"
              variant="ghost"
            >
              <PlusIcon />
            </Button>
          }
        />
      </ToolbarTip>
      <MenuPopup align="start">
        <MenuItem
          onClick={async () => {
            if (pageId) {
              await insertBlankPageWithNotice(pageId);
            }
          }}
        >
          <FilePlusIcon />
          Blank page after current
        </MenuItem>
        <MenuItem
          onClick={async () => {
            if (pageId) {
              await duplicatePageWithNotice(pageId);
            }
          }}
        >
          <CopyIcon />
          Duplicate current page
        </MenuItem>
        <MenuItem onClick={() => inputRef.current?.click()}>
          <FileInputIcon />
          Insert pages from PDF…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
};

const SelectPagesToggle = () => {
  const selecting = usePageSelectMode();
  const label = selecting ? "Stop selecting pages" : "Select pages";
  return (
    <ToolbarTip label={label}>
      <Button
        pressable
        aria-label={label}
        aria-pressed={selecting}
        onClick={() => setPageSelectMode(!selecting)}
        size="icon-xs"
        variant={selecting ? "secondary" : "ghost"}
      >
        <ListChecksIcon />
      </Button>
    </ToolbarTip>
  );
};

/** Bulk actions for the pages picked in the list. */
const PageSelectionBar = () => {
  const selected = useEditorStore((state) => state.selectedPageIds);
  const pageCount = useEditorStore((state) => state.document.pages.length);
  const isExporting = useEditorStore((state) => state.isExporting);
  const open = selected.length > 0;
  // Keep the last count on screen while the bar slides away.
  const [shownCount, setShownCount] = useState(selected.length);
  if (open && selected.length !== shownCount) {
    setShownCount(selected.length);
  }
  const canDelete = selected.length < pageCount;
  return (
    <div
      aria-label="Selected pages"
      className={cn(
        "border-border bg-popover absolute inset-x-3 bottom-[calc(--spacing(3)+env(safe-area-inset-bottom,0px))] z-10 flex items-center gap-1 rounded-lg border px-2 py-1 shadow-lg/5 transition-[opacity,translate] ease-out",
        open
          ? "opacity-100 duration-200"
          : "pointer-events-none opacity-0 duration-150 motion-safe:translate-y-[calc(100%+--spacing(3))]"
      )}
      inert={!open}
      role="toolbar"
    >
      <span className="text-muted-foreground mr-auto text-xs tabular-nums">
        {shownCount} selected
      </span>
      <ToolbarTip label="Extract as a new PDF">
        <Button
          pressable
          aria-label="Extract selected pages as a new PDF"
          disabled={isExporting}
          onClick={async () => {
            await exportPdfWithToast({ pageIds: selected });
          }}
          size="icon-xs"
          variant="ghost"
        >
          <FileOutputIcon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Rotate selected pages">
        <Button
          pressable
          aria-label="Rotate selected pages"
          onClick={() => editorStore.rotatePages(selected, 90)}
          size="icon-xs"
          variant="ghost"
        >
          <RotateCwIcon />
        </Button>
      </ToolbarTip>
      <ToolbarTip
        label={canDelete ? "Delete selected pages" : "Can't delete every page"}
      >
        <Button
          pressable
          aria-label="Delete selected pages"
          disabled={!canDelete}
          onClick={() => {
            if (editorStore.deletePages(selected)) {
              editorStore.clearPageSelection();
            }
          }}
          size="icon-xs"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Clear selection">
        <Button
          pressable
          aria-label="Clear page selection"
          onClick={() => setPageSelectMode(false)}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </ToolbarTip>
    </div>
  );
};

/**
 * A click on a page in the list: Ctrl/⌘ (or select mode) toggles it, Shift
 * selects a range, and a plain click opens it and drops the selection.
 */
const clickPage = (
  pageId: string,
  event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  selecting: boolean
): boolean => {
  if (event.shiftKey) {
    editorStore.selectPageRange(pageId);
    return false;
  }
  if (selecting || event.ctrlKey || event.metaKey) {
    editorStore.togglePageSelection(pageId);
    return false;
  }
  editorStore.clearPageSelection();
  editorStore.setCurrentPage(pageId);
  return true;
};

const moveCurrentPage = (
  pages: readonly EditorPage[],
  currentPageId: string | null,
  delta: -1 | 1
): void => {
  const from = pages.findIndex((page) => page.id === currentPageId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= pages.length) {
    return;
  }
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  if (!moved) {
    return;
  }
  next.splice(to, 0, moved);
  editorStore.setPages(next);
};

const PageActions = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const currentIndex = pages.findIndex((page) => page.id === currentPageId);
  const canDeletePage = pages.length > 1;
  const canMoveUp = currentIndex > 0;
  const canMoveDown = currentIndex !== -1 && currentIndex < pages.length - 1;

  return (
    <div className="flex gap-1">
      <SelectPagesToggle />
      <AddPageMenu pageId={currentPageId} />
      <ToolbarTip label="Move current page up">
        <Button
          pressable
          disabled={!canMoveUp}
          onClick={() => moveCurrentPage(pages, currentPageId, -1)}
          size="icon-xs"
          variant="ghost"
          aria-label="Move current page up"
        >
          <ChevronUpIcon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Move current page down">
        <Button
          pressable
          disabled={!canMoveDown}
          onClick={() => moveCurrentPage(pages, currentPageId, 1)}
          size="icon-xs"
          variant="ghost"
          aria-label="Move current page down"
        >
          <ChevronDownIcon />
        </Button>
      </ToolbarTip>
      <ToolbarTip label="Rotate current page">
        <Button
          pressable
          onClick={() => editorStore.rotateCurrentPage(90)}
          size="icon-xs"
          variant="ghost"
          aria-label="Rotate current page"
        >
          <RotateCwIcon />
        </Button>
      </ToolbarTip>
      <ToolbarTip
        label={
          canDeletePage ? "Delete current page" : "Can't delete the last page"
        }
      >
        <Button
          pressable
          disabled={!canDeletePage}
          onClick={() => {
            if (currentPageId) {
              deletePage(currentPageId);
            }
          }}
          size="icon-xs"
          variant="ghost"
          aria-label="Delete current page"
        >
          <Trash2Icon />
        </Button>
      </ToolbarTip>
    </div>
  );
};

interface DropEdge {
  edge: "after" | "before";
  index: number;
}

/** Reorder from the store's current pages, so rows need not hold the list. */
const movePage = (from: number, to: number): void => {
  const next = [...editorStore.getState().document.pages];
  const [moved] = next.splice(from, 1);
  if (!moved) {
    return;
  }
  next.splice(to, 0, moved);
  editorStore.setPages(next);
};

const PageThumbnailItemView = ({
  checked,
  dropEdge,
  index,
  onDragEndAt,
  onDragOverAt,
  onDragStartAt,
  onDropAt,
  onPageSelect,
  page,
  registerItem,
  selected,
  selecting,
}: {
  /** Picked for a bulk action. */
  checked: boolean;
  /** Which side of this page the drag would land on, if any. */
  dropEdge: "after" | "before" | null;
  index: number;
  onDragEndAt: () => void;
  onDragOverAt: (index: number, hasFiles: boolean) => void;
  onDragStartAt: (index: number) => void;
  onDropAt: (index: number) => void;
  onPageSelect?: () => void;
  page: EditorPage;
  registerItem: (pageId: string, node: HTMLButtonElement | null) => void;
  /** The current page. */
  selected: boolean;
  selecting: boolean;
}) => (
  <li className="relative flex flex-col gap-1" data-page-index={index}>
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            aria-current={selected ? "page" : undefined}
            aria-label={`Page ${index + 1}`}
            aria-pressed={selecting || checked ? checked : undefined}
            className={cn(
              "editor-pressable focus-visible:ring-ring rounded-md text-left outline-none focus-visible:ring-2",
              checked && "ring-primary ring-2 ring-offset-1"
            )}
            draggable
            onClick={(event) => {
              if (clickPage(page.id, event, selecting)) {
                onPageSelect?.();
              }
            }}
            onDragEnd={onDragEndAt}
            onDragOver={(event) => {
              event.preventDefault();
              onDragOverAt(index, event.dataTransfer.types.includes("Files"));
            }}
            onDragStart={() => onDragStartAt(index)}
            onDrop={() => onDropAt(index)}
            ref={(node) => registerItem(page.id, node)}
            type="button"
          />
        }
      >
        <PageThumbnail page={page} selected={selected} />
        {checked ? (
          <span
            aria-hidden
            className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full shadow-xs transition-[opacity,scale] duration-150 ease-out starting:opacity-0 motion-safe:starting:scale-80"
          >
            <CheckIcon className="size-3.5" />
          </span>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <ContextMenuItem
          onClick={async () => {
            await duplicatePageWithNotice(page.id);
          }}
        >
          <CopyIcon />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          onClick={async () => {
            await insertBlankPageWithNotice(page.id);
          }}
        >
          <FilePlusIcon />
          Insert blank page after
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            editorStore.setCurrentPage(page.id);
            editorStore.rotateCurrentPage(90);
          }}
        >
          <RotateCwIcon />
          Rotate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => deletePage(page.id)}
          variant="destructive"
        >
          <Trash2Icon />
          Delete
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
    <span className="text-muted-foreground text-center text-xs">
      {index + 1}
    </span>
    {(["before", "after"] as const).map((edge) => (
      <span
        aria-hidden
        className={cn(
          "bg-primary pointer-events-none absolute inset-x-0 h-0.5 rounded-full transition-[opacity,scale] duration-150 ease-out",
          edge === "before" ? "-top-[7px]" : "-bottom-[7px]",
          dropEdge === edge
            ? "scale-x-100 opacity-100"
            : "opacity-0 motion-safe:scale-x-60"
        )}
        key={edge}
      />
    ))}
  </li>
);

/** Memoized: an edit on one page re-renders only that page's row. */
const PageThumbnailItem = memo(PageThumbnailItemView);

const PageThumbnails = ({ onPageSelect }: { onPageSelect?: () => void }) => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const selectedPageIds = useEditorStore((state) => state.selectedPageIds);
  const selecting = usePageSelectMode();
  const checkedIds = new Set(selectedPageIds);
  const dragIndex = useRef<number | null>(null);
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null);
  const showDropEdge = useCallback((next: DropEdge | null) => {
    setDropEdge((current) =>
      current?.index === next?.index && current?.edge === next?.edge
        ? current
        : next
    );
  }, []);
  // dragenter/dragleave fire for every child crossed; count to know when the
  // drag has really left the list.
  const dragDepth = useRef(0);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const onDragStartAt = useCallback((index: number) => {
    dragIndex.current = index;
  }, []);
  const onDropAt = useCallback(
    (index: number) => {
      dragDepth.current = 0;
      showDropEdge(null);
      const from = dragIndex.current;
      dragIndex.current = null;
      if (from === null || from === index) {
        return;
      }
      movePage(from, index);
    },
    [showDropEdge]
  );
  const onDragOverAt = useCallback(
    (index: number, hasFiles: boolean) => {
      const from = dragIndex.current;
      if (from === null) {
        // A PDF from outside inserts before the page under the pointer.
        showDropEdge(hasFiles ? { edge: "before", index } : null);
        return;
      }
      if (from === index) {
        showDropEdge(null);
        return;
      }
      showDropEdge({ edge: from < index ? "after" : "before", index });
    },
    [showDropEdge]
  );
  const onDragEndAt = useCallback(() => {
    dragIndex.current = null;
    dragDepth.current = 0;
    showDropEdge(null);
  }, [showDropEdge]);

  const registerItem = useCallback(
    (pageId: string, node: HTMLButtonElement | null) => {
      if (node) {
        itemRefs.current.set(pageId, node);
        return;
      }
      itemRefs.current.delete(pageId);
    },
    []
  );

  useEffect(() => {
    if (!currentPageId) {
      return;
    }
    const node = itemRefs.current.get(currentPageId);
    node?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [currentPageId]);

  return (
    <div
      onDragEnter={() => {
        dragDepth.current += 1;
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          showDropEdge(null);
        }
      }}
      onDragOver={(event) => {
        const hasFiles = event.dataTransfer.types.includes("Files");
        if (hasFiles) {
          event.preventDefault();
        }
        const overItem =
          event.target instanceof Element &&
          event.target.closest("li[data-page-index]") !== null;
        if (overItem) {
          return;
        }
        showDropEdge(
          hasFiles && pages.length > 0
            ? { edge: "after", index: pages.length - 1 }
            : null
        );
      }}
      onDrop={async (event) => {
        dragDepth.current = 0;
        showDropEdge(null);
        const file = firstPdf(event.dataTransfer.files);
        if (!file) {
          return;
        }
        event.preventDefault();
        // Before the page dropped on, or at the end below the last one.
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("li[data-page-index]")
            : null;
        const index = Number(target?.dataset.pageIndex ?? pages.length);
        await insertPdfWithNotice(file, index);
      }}
    >
      <ol
        className={cn(
          "flex flex-col gap-3 pt-2",
          selectedPageIds.length > 0 ? "pb-16" : "pb-3"
        )}
      >
        {pages.map((page, index) => (
          <PageThumbnailItem
            checked={checkedIds.has(page.id)}
            dropEdge={dropEdge?.index === index ? dropEdge.edge : null}
            index={index}
            key={page.id}
            onDragEndAt={onDragEndAt}
            onDragOverAt={onDragOverAt}
            onDragStartAt={onDragStartAt}
            onDropAt={onDropAt}
            onPageSelect={onPageSelect}
            page={page}
            registerItem={registerItem}
            selected={page.id === currentPageId}
            selecting={selecting}
          />
        ))}
      </ol>
    </div>
  );
};

export const PageSheetButton = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const [open, setOpen] = useState(false);
  const closeSheet = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        pressable
        aria-label="Pages"
        className="md:hidden"
        disabled={pages.length === 0}
        onClick={() => setOpen(true)}
        size="icon-sm"
        variant="ghost"
      >
        <SquareStackIcon />
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogPopup className="md:max-w-sm">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-8">
              <DialogTitle>Pages</DialogTitle>
              <PageActions />
            </div>
          </DialogHeader>
          <DialogPanel>
            <PageThumbnails onPageSelect={closeSheet} />
          </DialogPanel>
          <PageSelectionBar />
        </DialogPopup>
      </Dialog>
    </>
  );
};

export const PageSidebar = () => {
  const pages = useEditorStore((state) => state.document.pages);

  if (pages.length === 0) {
    return (
      <aside className="border-border bg-background text-muted-foreground hidden border-r p-3 text-xs md:block">
        Pages
      </aside>
    );
  }

  return (
    <aside className="border-border bg-background relative hidden min-h-0 flex-col border-r md:flex">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Pages
        </p>
        <PageActions />
      </div>
      <ScrollArea className="min-h-0 flex-1" overscrollContain>
        <div className="px-3">
          <PageThumbnails />
        </div>
      </ScrollArea>
      <PageSelectionBar />
    </aside>
  );
};
