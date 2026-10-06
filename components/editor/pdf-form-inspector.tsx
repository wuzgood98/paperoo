"use client";

import { documentForm } from "@/lib/editor/object-utils";
import { useEditorStore } from "@/lib/editor/store";
import type { PdfFormField, PdfFormFieldKind } from "@/lib/editor/types";

const KIND_LABEL: Record<PdfFormFieldKind, string> = {
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  listbox: "List box",
  radio: "Radio",
  signature: "Signature",
  text: "Text",
};

export const PdfFormInspector = ({ field }: { field: PdfFormField }) => {
  const form = useEditorStore((state) => documentForm(state.document));
  const notes: string[] = [];
  if (form.hasJavaScript) {
    notes.push("This PDF has JavaScript; calculated fields are not evaluated.");
  }
  if (form.signatures.length > 0) {
    notes.push(
      "Existing digital signatures will not verify after export. Signature fields are not signed here."
    );
  }
  if (field.kind === "signature") {
    notes.push("Signature fields are display-only.");
  }
  if (field.kind === "text" && field.richText) {
    notes.push("Rich-text fields are not editable.");
  }
  if (field.kind === "text" && field.fileSelect) {
    notes.push("File-select fields are not editable.");
  }

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
      <span className="font-medium">{field.name}</span>
      <span className="text-muted-foreground">{KIND_LABEL[field.kind]}</span>
      {field.required ? (
        <span className="text-muted-foreground">Required</span>
      ) : null}
      {field.readOnly ? (
        <span className="text-muted-foreground">Read-only</span>
      ) : null}
      {notes.map((note) => (
        <span className="text-muted-foreground max-w-xl text-xs" key={note}>
          {note}
        </span>
      ))}
    </div>
  );
};
