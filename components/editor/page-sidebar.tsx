"use client";

import { RotateCwIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";

import { PageThumbnail } from "@/components/editor/page-thumbnail";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { editorStore, useEditorStore } from "@/lib/editor/store";

export const PageSidebar = () => {
  const pages = useEditorStore((state) => state.document.pages);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const dragIndex = useRef<number | null>(null);

  if (pages.length === 0) {
    return (
      <aside className="border-border bg-background text-muted-foreground border-r p-3 text-xs">
        Pages
      </aside>
    );
  }

  return (
    <aside className="border-border bg-background flex min-h-0 flex-col border-r">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Pages
        </p>
        <div className="flex gap-1">
          <Button
            pressable
            onClick={() => editorStore.rotateCurrentPage(90)}
            size="icon-xs"
            variant="ghost"
          >
            <RotateCwIcon />
          </Button>
          <Button
            pressable
            onClick={() => {
              const next = pages.filter((page) => page.id !== currentPageId);
              if (next.length === 0) {
                return;
              }
              editorStore.setPages(next);
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="flex flex-col gap-3 px-3 pb-3">
          {pages.map((page, index) => (
            <li className="flex flex-col gap-1" key={page.id}>
              <button
                className="editor-pressable focus-visible:ring-ring rounded-md text-left outline-none focus-visible:ring-2"
                draggable
                onClick={() => editorStore.setCurrentPage(page.id)}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDrop={() => {
                  const from = dragIndex.current;
                  dragIndex.current = null;
                  if (from === null || from === index) {
                    return;
                  }
                  const next = [...pages];
                  const [moved] = next.splice(from, 1);
                  if (!moved) {
                    return;
                  }
                  next.splice(index, 0, moved);
                  editorStore.setPages(next);
                }}
                type="button"
              >
                <PageThumbnail
                  page={page}
                  selected={page.id === currentPageId}
                />
              </button>
              <span className="text-muted-foreground text-center text-xs">
                {index + 1}
              </span>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </aside>
  );
};
