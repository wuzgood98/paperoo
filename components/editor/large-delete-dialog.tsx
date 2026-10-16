"use client";

import { useSyncExternalStore } from "react";

import {
  isLargeDeleteConfirming,
  setLargeDeleteConfirming,
  subscribeLargeDelete,
} from "@/components/editor/large-delete";
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
import { editorStore } from "@/lib/editor/store";

export const LargeDeleteDialog = () => {
  const open = useSyncExternalStore(
    subscribeLargeDelete,
    isLargeDeleteConfirming,
    () => false
  );
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next) {
          setLargeDeleteConfirming(false);
        }
      }}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this large shape?</AlertDialogTitle>
          <AlertDialogDescription>
            It covers more than half of the page. You can undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button
            onClick={() => {
              setLargeDeleteConfirming(false);
              editorStore.deleteSelected();
            }}
            variant="destructive"
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};
