"use client";

import { EraserIcon, FormInputIcon } from "lucide-react";

import { ToolbarTip } from "@/components/editor/toolbar-tip";
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
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  setHighlightFormFields,
  useHighlightFormFields,
} from "@/lib/editor/form-highlight";
import {
  documentForm,
  isPdfFormFieldDirty,
  isPdfFormFieldEditable,
} from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";

export interface FormStatus {
  /** Some field differs from when the PDF was opened. */
  changed: boolean;
  /** The PDF has at least one field that can be filled. */
  fillable: boolean;
}

export const useFormStatus = (): FormStatus => {
  const fillable = useEditorStore((state) =>
    documentForm(state.document).fields.some(isPdfFormFieldEditable)
  );
  const changed = useEditorStore((state) =>
    documentForm(state.document).fields.some(isPdfFormFieldDirty)
  );
  return { changed, fillable };
};

/** The form actions, shared by the toolbar's Form menu and the phone's More menu. */
export const FormMenuItems = ({
  changed,
  onClear,
}: {
  changed: boolean;
  onClear: () => void;
}) => {
  const highlight = useHighlightFormFields();
  return (
    <>
      <MenuCheckboxItem
        checked={highlight}
        onCheckedChange={setHighlightFormFields}
      >
        Highlight fields
      </MenuCheckboxItem>
      <MenuItem disabled={!changed} onClick={onClear}>
        <EraserIcon />
        Clear form…
      </MenuItem>
    </>
  );
};

export const FormMenuButton = ({
  changed,
  disabled,
  onClear,
}: {
  changed: boolean;
  disabled: boolean;
  onClear: () => void;
}) => (
  <Menu>
    <ToolbarTip label="Form">
      <MenuTrigger
        className="hidden md:inline-flex"
        disabled={disabled}
        render={
          <Button
            pressable
            aria-label="Form"
            disabled={disabled}
            size="icon-sm"
            variant="ghost"
          >
            <FormInputIcon />
          </Button>
        }
      />
    </ToolbarTip>
    <MenuPopup align="end">
      <FormMenuItems changed={changed} onClear={onClear} />
    </MenuPopup>
  </Menu>
);

export const ClearFormDialog = ({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <AlertDialog onOpenChange={onOpenChange} open={open}>
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Clear the form?</AlertDialogTitle>
        <AlertDialogDescription>
          Every field goes back to what it showed when you opened the PDF. You
          can undo this.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="ghost" />}>
          Cancel
        </AlertDialogClose>
        <Button
          onClick={() => {
            editorStore.resetPdfForm();
            onOpenChange(false);
          }}
          variant="destructive"
        >
          Clear form
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  </AlertDialog>
);
