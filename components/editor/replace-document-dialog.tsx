"use client";

import { useSyncExternalStore } from "react";

import {
  isReplaceDocumentConfirming,
  resolveReplaceDocument,
  subscribeReplaceDocument,
} from "@/components/editor/replace-document";
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

export const ReplaceDocumentDialog = () => {
  const open = useSyncExternalStore(
    subscribeReplaceDocument,
    isReplaceDocumentConfirming,
    () => false
  );
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next) {
          resolveReplaceDocument("cancel");
        }
      }}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Open another file?</AlertDialogTitle>
          <AlertDialogDescription>
            This PDF has edits you haven’t exported. Opening another file
            discards them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button
            onClick={() => resolveReplaceDocument("discard")}
            variant="destructive-outline"
          >
            Discard edits
          </Button>
          <Button onClick={() => resolveReplaceDocument("export")}>
            Export first
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};
