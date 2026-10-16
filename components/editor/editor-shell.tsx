"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { EditorHotkeys } from "@/components/editor/editor-hotkeys";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { EmptyState } from "@/components/editor/empty-state";
import { LargeDeleteDialog } from "@/components/editor/large-delete-dialog";
import { PageSidebar } from "@/components/editor/page-sidebar";
import { SignatureDialog } from "@/components/editor/signature-dialog";
import { ToolRail } from "@/components/editor/tool-rail";
import { Spinner } from "@/components/ui/spinner";
import { useEditorStore } from "@/lib/editor/store";
import type { EditorStatus } from "@/lib/editor/types";
import { ensurePdfjsWorker } from "@/lib/pdf/pdfjs";

const EditorViewport = dynamic(
  async () => {
    const viewport = await import("@/components/editor/editor-viewport");
    return viewport.EditorViewport;
  },
  { ssr: false }
);

const EditorMain = ({ status }: { status: EditorStatus }) => {
  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (status === "ready") {
    return <EditorViewport />;
  }
  return <EmptyState />;
};

export const EditorShell = () => {
  const status = useEditorStore((state) => state.status);

  useEffect(() => {
    // Warm the pdf.js worker off the critical path so the first file
    // select skips worker spawn + script compile.
    if (typeof window === "undefined") {
      return;
    }
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => {
        ensurePdfjsWorker();
      });
      return () => window.cancelIdleCallback(id);
    }
    const timer = globalThis.setTimeout(() => {
      ensurePdfjsWorker();
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, []);

  return (
    <div className="bg-background flex h-svh min-h-0 flex-col overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] [--editor-page-sidebar:220px]">
      <EditorHotkeys />
      <EditorToolbar />
      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[var(--editor-page-sidebar)_minmax(0,1fr)_56px]">
        <PageSidebar />
        <main className="bg-muted/40 min-h-0 flex-1 overflow-hidden">
          <EditorMain status={status} />
        </main>
        <ToolRail />
      </div>
      <SignatureDialog />
      <LargeDeleteDialog />
    </div>
  );
};
