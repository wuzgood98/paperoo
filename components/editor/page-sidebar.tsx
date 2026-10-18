"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  FileOutputIcon,
  ListChecksIcon,
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
  const disabled = !(hydrated && pageId);
  return (
    <Menu>
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
  if (selected.length === 0) {
    return null;
  }
  const canDelete = selected.length < pageCount;
  return (
    <div
      aria-label="Selected pages"
      className="border-border bg-muted/60 mx-3 mb-2 flex items-center gap-1 rounded-md border px-2 py-1"
      role="toolbar"
    >
      <span className="text-muted-foreground mr-auto text-xs tabular-nums">
        {selected.length} selected
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
  index,
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
  index: number;
  onDragStartAt: (index: number) => void;
  onDropAt: (index: number) => void;
  onPageSelect?: () => void;
  page: EditorPage;
  registerItem: (pageId: string, node: HTMLButtonElement | null) => void;
  /** The current page. */
  selected: boolean;
  selecting: boolean;
}) => (
  <li className="relative flex flex-col gap-1">
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
            onDragOver={(event) => {
              event.preventDefault();
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
            className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full shadow-xs"
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
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const onDragStartAt = useCallback((index: number) => {
    dragIndex.current = index;
  }, []);
  const onDropAt = useCallback((index: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) {
      return;
    }
    movePage(from, index);
  }, []);

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
    <ol className="flex flex-col gap-3 pb-3">
      {pages.map((page, index) => (
        <PageThumbnailItem
          checked={checkedIds.has(page.id)}
          index={index}
          key={page.id}
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
          <PageSelectionBar />
          <DialogPanel>
            <PageThumbnails onPageSelect={closeSheet} />
          </DialogPanel>
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
    <aside className="border-border bg-background hidden min-h-0 flex-col border-r md:flex">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Pages
        </p>
        <PageActions />
      </div>
      <PageSelectionBar />
      <ScrollArea className="min-h-0 flex-1" overscrollContain>
        <div className="px-3">
          <PageThumbnails />
        </div>
      </ScrollArea>
    </aside>
  );
};
