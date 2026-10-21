"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { EditorClipboard } from "@/components/editor/editor-clipboard";
import { EditorHotkeys } from "@/components/editor/editor-hotkeys";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { EmptyState } from "@/components/editor/empty-state";
import { FormGlyphDialog } from "@/components/editor/form-glyph-dialog";
import { LargeDeleteDialog } from "@/components/editor/large-delete-dialog";
import { PageSidebar } from "@/components/editor/page-sidebar";
import { RedactionConfirmDialog } from "@/components/editor/redaction-confirm-dialog";
import { ReplaceDocumentDialog } from "@/components/editor/replace-document-dialog";
import { SignatureDialog } from "@/components/editor/signature-dialog";
import { ToolRail } from "@/components/editor/tool-rail";
import { UnsavedChangesGuard } from "@/components/editor/unsaved-changes-guard";
import { Spinner } from "@/components/ui/spinner";
import { useEditorStore } from "@/lib/editor/store";
import type { EditorStatus } from "@/lib/editor/types";
import { prewarmPdfOpen } from "@/lib/pdf/open-pdf";

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

/** Autosave loads once a document is open; visitors who never open one skip it. */
const loadAutosave = () => import("@/lib/session/browser-autosave");

const startAutosave = async (): Promise<void> => {
  const autosave = await loadAutosave();
  autosave.startAutosave();
};

const useAutosave = (status: EditorStatus): void => {
  useEffect(() => {
    if (status === "ready") {
      void startAutosave();
    }
  }, [status]);
};

export const EditorShell = () => {
  const status = useEditorStore((state) => state.status);
  useAutosave(status);

  useEffect(() => {
    // A file dragged over the window is about to be dropped; open buttons
    // prewarm on hover and focus themselves.
    const onDragEnter = async (): Promise<void> => {
      window.removeEventListener("dragenter", onDragEnter);
      await prewarmPdfOpen();
    };
    window.addEventListener("dragenter", onDragEnter);
    return () => window.removeEventListener("dragenter", onDragEnter);
  }, []);

  return (
    <div className="bg-background flex h-svh min-h-0 flex-col overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] [--editor-page-sidebar:220px]">
      <EditorHotkeys />
      <EditorClipboard />
      <UnsavedChangesGuard />
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
      <RedactionConfirmDialog />
      <FormGlyphDialog />
      <ReplaceDocumentDialog />
    </div>
  );
};
