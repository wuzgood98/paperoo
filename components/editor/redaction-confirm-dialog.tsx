"use client";

import { useSyncExternalStore } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  answerRedactionPrompt,
  redactionPrompt,
  subscribeRedactionPrompt,
} from "@/lib/editor/redaction-gate";

export const RedactionConfirmDialog = () => {
  const prompt = useSyncExternalStore(
    subscribeRedactionPrompt,
    redactionPrompt,
    () => null
  );
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next) {
          answerRedactionPrompt(false);
        }
      }}
      open={prompt !== null}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Apply redactions?</AlertDialogTitle>
          <AlertDialogDescription>
            Everything under the boxes is removed from the file for good, and
            pages with boxes become images. Text outside the boxes stays
            searchable. Your document here is not changed.
          </AlertDialogDescription>
          {prompt?.unredactedCopies ? (
            <AlertDialogDescription>
              A redacted page also appears in the document without boxes, as a
              copy. That copy keeps its content.
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button
            onClick={() => answerRedactionPrompt(true)}
            variant="destructive"
          >
            Apply redactions
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};
