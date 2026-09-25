"use client";

import dynamic from "next/dynamic";

import { EditorHotkeys } from "@/components/editor/editor-hotkeys";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { EmptyState } from "@/components/editor/empty-state";
import { PageSidebar } from "@/components/editor/page-sidebar";
import { SignatureDialog } from "@/components/editor/signature-dialog";
import { ToolRail } from "@/components/editor/tool-rail";
import { Spinner } from "@/components/ui/spinner";
import { useEditorStore } from "@/lib/editor/store";
import type { EditorStatus } from "@/lib/editor/types";

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

  return (
    <div className="bg-background flex h-svh min-h-0 flex-col overflow-hidden">
      <EditorHotkeys />
      <EditorToolbar />
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_56px]">
        <PageSidebar />
        <main className="bg-muted/40 min-h-0 overflow-hidden">
          <EditorMain status={status} />
        </main>
        <ToolRail />
      </div>
      <SignatureDialog />
    </div>
  );
};
