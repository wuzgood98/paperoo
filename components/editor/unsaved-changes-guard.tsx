"use client";

import { useEffect } from "react";

import { useIsDirty } from "@/lib/editor/store";

const onBeforeUnload = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
  // Chromium before 119 shows the prompt only when returnValue is set.
  event.returnValue = "";
};

/**
 * Ask before a reload or tab close discards unexported edits. The listener
 * exists only while there are edits: any `beforeunload` listener keeps the
 * page out of Firefox's back/forward cache.
 */
export const UnsavedChangesGuard = () => {
  const dirty = useIsDirty();
  useEffect(() => {
    if (!dirty) {
      return;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return null;
};
