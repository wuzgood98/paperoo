"use client";

import { useEffect } from "react";

import { toastManager } from "@/components/ui/toast-manager";
import {
  CLIPBOARD_MARKER_TYPE,
  MAX_PASTED_TEXT,
  clipboardEntry,
  copySelection,
  createPastedTextObject,
  fitImageToPage,
  pasteClipboard,
} from "@/lib/editor/clipboard";
import { shouldHandleClipboardEvent } from "@/lib/editor/clipboard-gate";
import { createImageObject, findPage } from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import { readImageFile } from "@/lib/pdf/image-file";

/** How long a ⌘V waits for its paste event before pasting copied objects. */
const PASTE_EVENT_GRACE_MS = 50;

const isEditorReady = (): boolean => editorStore.getState().status === "ready";

const handles = (event: Event): boolean =>
  isEditorReady() &&
  shouldHandleClipboardEvent(event.target, window.getSelection());

const writeEntry = (data: DataTransfer | null): boolean => {
  const entry = copySelection();
  if (!entry) {
    return false;
  }
  data?.setData("text/plain", entry.text);
  data?.setData(CLIPBOARD_MARKER_TYPE, entry.id);
  return true;
};

const currentPage = () => {
  const state = editorStore.getState();
  return findPage(state.document.pages, state.currentPageId);
};

const pasteImage = async (file: File): Promise<void> => {
  const page = currentPage();
  if (!page) {
    return;
  }
  try {
    const image = await readImageFile(file);
    const size = fitImageToPage(image, page.width);
    const asset = editorStore.addAsset(image.bytes, image.mimeType);
    editorStore.insertObjects(page.id, [
      createImageObject(
        {
          x: Math.max(0, (page.width - size.width) / 2),
          y: Math.max(0, (page.height - size.height) / 2),
        },
        size,
        asset.id,
        image.mimeType
      ),
    ]);
  } catch (error) {
    toastManager.add({
      description:
        error instanceof Error ? error.message : "Could not paste the image.",
      title: "Paste failed",
      type: "error",
    });
  }
};

const pasteText = (text: string): void => {
  const page = currentPage();
  if (!page || text.trim() === "") {
    return;
  }
  if (text.length > MAX_PASTED_TEXT) {
    toastManager.add({
      description: `Only the first ${MAX_PASTED_TEXT.toLocaleString()} characters were pasted.`,
      title: "Text shortened",
      type: "warning",
    });
  }
  const object = createPastedTextObject(
    text,
    editorStore.getState().textStyle,
    page
  );
  editorStore.insertObjects(page.id, [object]);
};

const imageFile = (data: DataTransfer): File | null => {
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
};

/** Copied objects are on the clipboard when it still holds what we wrote. */
const holdsEntry = (data: DataTransfer): boolean => {
  const entry = clipboardEntry();
  if (!entry) {
    return false;
  }
  const marker = data.getData(CLIPBOARD_MARKER_TYPE);
  if (marker) {
    return marker === entry.id;
  }
  // Some browsers drop custom types; matching text with no image still is ours.
  return data.files.length === 0 && data.getData("text/plain") === entry.text;
};

/**
 * Copy, cut and paste for overlay objects, plus images and plain text
 * pasted from other apps. Listens for the clipboard events, not keys: they
 * need no permission and also fire from the browser's Edit menu.
 */
export const EditorClipboard = () => {
  useEffect(() => {
    /** Set by a paste event so the ⌘V fallback stands down. */
    let pasteSeen = false;
    let copySeen = false;
    /** A ⌘C/⌘X/⌘V fallback waiting to see whether its event fires. */
    let pending: {
      run: () => void;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    // A clipboard event fires right after its keydown, so by the next key
    // the fallback knows whether it is needed: run it before that key acts.
    const flushPending = (): void => {
      const current = pending;
      pending = null;
      if (current) {
        clearTimeout(current.timer);
        current.run();
      }
    };
    const later = (run: () => void, delay: number): void => {
      flushPending();
      pending = { run, timer: setTimeout(flushPending, delay) };
    };

    const onCopy = (event: ClipboardEvent): void => {
      copySeen = true;
      if (!handles(event)) {
        return;
      }
      if (writeEntry(event.clipboardData)) {
        event.preventDefault();
      }
    };

    const onCut = (event: ClipboardEvent): void => {
      copySeen = true;
      if (!handles(event)) {
        return;
      }
      if (writeEntry(event.clipboardData)) {
        event.preventDefault();
        editorStore.deleteSelected();
      }
    };

    const onPaste = (event: ClipboardEvent): void => {
      pasteSeen = true;
      const data = event.clipboardData;
      if (!data || !handles(event)) {
        return;
      }
      if (holdsEntry(data)) {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      const file = imageFile(data);
      if (file) {
        event.preventDefault();
        void pasteImage(file);
        return;
      }
      const text = data.getData("text/plain");
      if (text) {
        event.preventDefault();
        pasteText(text);
      }
    };

    // Safari skips copy and paste events when nothing editable or selected
    // has focus. Fall back to the in-memory clipboard for ⌘C, ⌘X and ⌘V,
    // leaving the keys to the browser so the events still fire where they can.
    const onKeyDown = (event: KeyboardEvent): void => {
      flushPending();
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.shiftKey || event.altKey || !handles(event)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "c" || key === "x") {
        copySeen = false;
        later(() => {
          if (copySeen || !copySelection()) {
            return;
          }
          if (key === "x") {
            editorStore.deleteSelected();
          }
        }, 0);
        return;
      }
      if (key === "v") {
        pasteSeen = false;
        later(() => {
          if (!pasteSeen) {
            pasteClipboard();
          }
        }, PASTE_EVENT_GRACE_MS);
      }
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKeyDown);
      if (pending) {
        clearTimeout(pending.timer);
      }
    };
  }, []);

  return null;
};
