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
  answerFormGlyphPrompt,
  formGlyphPrompt,
  subscribeFormGlyphPrompt,
} from "@/lib/editor/form-glyph-gate";

const FIELDS_LISTED = 5;

export const FormGlyphDialog = () => {
  const fields = useSyncExternalStore(
    subscribeFormGlyphPrompt,
    formGlyphPrompt,
    () => null
  );
  const listed = fields?.slice(0, FIELDS_LISTED) ?? [];
  const more = (fields?.length ?? 0) - listed.length;
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next) {
          answerFormGlyphPrompt(false);
        }
      }}
      open={fields !== null}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Some letters can&apos;t be shown</AlertDialogTitle>
          <AlertDialogDescription>
            These form fields have letters the PDF fonts don&apos;t include.
            They will show as empty boxes in the file. The typed text is still
            saved, so another app may show it correctly.
          </AlertDialogDescription>
          <ul className="text-muted-foreground text-sm">
            {listed.map((field) => (
              <li key={field.name}>
                <span className="text-foreground font-medium">
                  {field.name}
                </span>
                : {field.letters.join(" ")}
              </li>
            ))}
            {more > 0 ? <li>and {more} more</li> : null}
          </ul>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button onClick={() => answerFormGlyphPrompt(true)}>
            Continue anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};
