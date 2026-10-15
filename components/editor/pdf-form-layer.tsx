"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import {
  isPdfFormFieldDirty,
  isPdfFormFieldEditable,
  pdfFormChoiceDisplay,
  pdfFormFieldPreviewText,
  pdfFormWidgetsOnPage,
} from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type {
  PdfFormDropdownField,
  PdfFormField,
  PdfFormListboxField,
  PdfFormTextField,
  PdfFormWidget,
} from "@/lib/editor/types";
import { cn } from "@/lib/utils";

const FORM_CONTROL_FONT_INSET = 2;
const FORM_CONTROL_MAX_FONT = 12;
const FORM_CONTROL_MIN_FONT = 8;
const LISTBOX_MAX_VISIBLE_OPTIONS = 8;
const LISTBOX_MIN_VISIBLE_OPTIONS = 2;

const startsInlineEdit = (field: PdfFormField): boolean =>
  field.kind === "text" ||
  field.kind === "dropdown" ||
  field.kind === "listbox";

const widgetBoxStyle = (widget: PdfFormWidget, zoom: number) =>
  objectWrapperStyle({ ...widget, rotation: 0 }, zoom);

const controlFontStyle = (
  widget: PdfFormWidget,
  zoom: number,
  align: PdfFormTextField["align"] = "left"
): CSSProperties => {
  const fontSize = Math.max(
    FORM_CONTROL_MIN_FONT,
    Math.min(widget.height - FORM_CONTROL_FONT_INSET, FORM_CONTROL_MAX_FONT)
  );
  return {
    fontSize: pageToCss(fontSize, zoom),
    textAlign: align,
  };
};

const patchSelectedField = (updater: (field: PdfFormField) => PdfFormField) => {
  editorStore.patchPdfFormField(updater);
};

const FormCoverPlate = ({
  preview,
  widget,
  zoom,
}: {
  preview: string;
  widget: PdfFormWidget;
  zoom: number;
}) => (
  <div
    className="pointer-events-none absolute inset-0 overflow-hidden bg-white text-[#111827]"
    style={controlFontStyle(widget, zoom)}
  >
    <div className="flex h-full w-full items-center px-0.5 whitespace-pre-wrap">
      {preview}
    </div>
  </div>
);

const FormTextControl = ({
  field,
  onExit,
  widget,
  zoom,
}: {
  field: PdfFormTextField;
  onExit: () => void;
  widget: PdfFormWidget;
  zoom: number;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const discardRef = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? field.value;
  const maxLength = field.maxLength ?? undefined;

  useEffect(() => {
    const input = field.multiline ? textareaRef.current : inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const { length } = input.value;
    input.setSelectionRange(length, length);
  }, [field.multiline]);

  const commit = (next: string): void => {
    if (next !== field.value) {
      patchSelectedField((current) =>
        current.kind === "text" && current.id === field.id
          ? { ...current, value: next }
          : current
      );
    }
    onExit();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      discardRef.current = true;
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter" && !field.multiline) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const onBlur = (): void => {
    if (discardRef.current) {
      discardRef.current = false;
      onExit();
      return;
    }
    commit(value);
  };

  const shared = {
    "aria-label": field.name,
    className:
      "absolute inset-0 h-full w-full resize-none border-0 bg-white p-0.5 text-[#111827] outline-none",
    maxLength,
    onBlur,
    onChange: (event: {
      currentTarget: HTMLInputElement | HTMLTextAreaElement;
    }) => {
      setDraft(event.currentTarget.value);
    },
    onKeyDown,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation();
    },
    style: controlFontStyle(widget, zoom, field.align),
    value,
  };

  if (field.multiline) {
    return <textarea {...shared} ref={textareaRef} />;
  }

  return (
    <input
      {...shared}
      autoComplete="off"
      ref={inputRef}
      spellCheck={false}
      type={field.password ? "password" : "text"}
    />
  );
};

const FormDropdownControl = ({
  field,
  widget,
  zoom,
}: {
  field: PdfFormDropdownField;
  widget: PdfFormWidget;
  zoom: number;
}) => {
  const listId = useId();
  const displayValue =
    pdfFormChoiceDisplay(field.options, field.value) || (field.value ?? "");

  const commitExport = (exportValue: string): void => {
    if (exportValue === (field.value ?? "")) {
      return;
    }
    patchSelectedField((current) =>
      current.kind === "dropdown" && current.id === field.id
        ? { ...current, value: exportValue.length > 0 ? exportValue : null }
        : current
    );
  };

  if (field.editable) {
    return (
      <>
        <input
          aria-label={field.name}
          autoComplete="off"
          className="absolute inset-0 h-full w-full border-0 bg-white p-0.5 text-[#111827] outline-none"
          defaultValue={displayValue}
          list={listId}
          onBlur={(event) => {
            const typed = event.currentTarget.value;
            const match = field.options.find(
              (option) =>
                option.display === typed || option.exportValue === typed
            );
            commitExport(match?.exportValue ?? typed);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          style={controlFontStyle(widget, zoom)}
        />
        <datalist id={listId}>
          {field.options.map((option) => (
            <option key={option.exportValue} value={option.display}>
              {option.display}
            </option>
          ))}
        </datalist>
      </>
    );
  }

  return (
    <select
      aria-label={field.name}
      className="absolute inset-0 h-full w-full border-0 bg-white text-[#111827] outline-none"
      onChange={(event) => {
        commitExport(event.currentTarget.value);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      style={controlFontStyle(widget, zoom)}
      value={field.value ?? ""}
    >
      <option value="">Select…</option>
      {field.options.map((option) => (
        <option key={option.exportValue} value={option.exportValue}>
          {option.display}
        </option>
      ))}
    </select>
  );
};

const FormListboxControl = ({
  field,
  widget,
  zoom,
}: {
  field: PdfFormListboxField;
  widget: PdfFormWidget;
  zoom: number;
}) => (
  <select
    aria-label={field.name}
    className="absolute inset-0 h-full w-full border-0 bg-white text-[#111827] outline-none"
    multiple={field.multiSelect}
    onChange={(event) => {
      const next = Array.from(
        event.currentTarget.selectedOptions,
        (option) => option.value
      );
      patchSelectedField((current) =>
        current.kind === "listbox" && current.id === field.id
          ? { ...current, value: next }
          : current
      );
    }}
    onPointerDown={(event) => {
      event.stopPropagation();
    }}
    size={Math.max(
      LISTBOX_MIN_VISIBLE_OPTIONS,
      Math.min(field.options.length, LISTBOX_MAX_VISIBLE_OPTIONS)
    )}
    style={controlFontStyle(widget, zoom)}
    value={field.multiSelect ? field.value : (field.value[0] ?? "")}
  >
    {field.options.map((option) => (
      <option key={option.exportValue} value={option.exportValue}>
        {option.display}
      </option>
    ))}
  </select>
);

const activateWidget = (field: PdfFormField, widget: PdfFormWidget): void => {
  editorStore.selectPdfFormField(field.id);
  if (!isPdfFormFieldEditable(field)) {
    return;
  }
  if (field.kind === "checkbox") {
    patchSelectedField((current) =>
      current.kind === "checkbox" && current.id === field.id
        ? { ...current, value: !current.value }
        : current
    );
    return;
  }
  if (field.kind === "radio") {
    const next = widget.exportValue;
    if (next === null || next === field.value) {
      return;
    }
    patchSelectedField((current) =>
      current.kind === "radio" && current.id === field.id
        ? { ...current, value: next }
        : current
    );
  }
};

const FormWidgetChrome = ({
  editing,
  field,
  hovered,
  onBeginEdit,
  onExitEdit,
  selected,
  tabIndex,
  widget,
  zoom,
}: {
  editing: boolean;
  field: PdfFormField;
  hovered: boolean;
  onBeginEdit: (fieldId: string) => void;
  onExitEdit: () => void;
  selected: boolean;
  tabIndex: number;
  widget: PdfFormWidget;
  zoom: number;
}) => {
  const dirty = isPdfFormFieldDirty(field);
  const editable = isPdfFormFieldEditable(field);
  const showControl = editing && editable && startsInlineEdit(field);
  const preview = dirty ? pdfFormFieldPreviewText(field, widget) : "";
  let chromeClass: string | undefined;
  if (selected) {
    chromeClass = "outline-primary outline";
  } else if (hovered) {
    chromeClass = "outline-primary/40 outline";
  }

  return (
    <div
      className={cn("absolute origin-center", chromeClass)}
      style={widgetBoxStyle(widget, zoom)}
    >
      {dirty && !showControl ? (
        <FormCoverPlate preview={preview} widget={widget} zoom={zoom} />
      ) : null}
      {showControl && field.kind === "text" ? (
        <FormTextControl
          field={field}
          onExit={onExitEdit}
          widget={widget}
          zoom={zoom}
        />
      ) : null}
      {showControl && field.kind === "dropdown" ? (
        <FormDropdownControl field={field} widget={widget} zoom={zoom} />
      ) : null}
      {showControl && field.kind === "listbox" ? (
        <FormListboxControl field={field} widget={widget} zoom={zoom} />
      ) : null}
      {showControl ? null : (
        <button
          aria-label={field.name}
          className="absolute inset-0 cursor-text bg-transparent"
          onClick={() => {
            activateWidget(field, widget);
            if (editable && startsInlineEdit(field)) {
              onBeginEdit(field.id);
            }
          }}
          onFocus={() => {
            editorStore.selectPdfFormField(field.id);
            if (editable && startsInlineEdit(field)) {
              onBeginEdit(field.id);
            }
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          tabIndex={tabIndex}
          type="button"
        />
      )}
    </div>
  );
};

export const PdfFormLayer = ({
  editingId,
  hoveredId,
  onBeginEdit,
  onExitEdit,
  pageId,
  selectedId,
  zoom,
}: {
  editingId: string | null;
  hoveredId: string | null;
  onBeginEdit: (fieldId: string) => void;
  onExitEdit: () => void;
  pageId: string;
  selectedId: string | null;
  zoom: number;
}) => {
  const document = useEditorStore((state) => state.document);
  const items = pdfFormWidgetsOnPage(document, pageId);

  return (
    <>
      {items.map(({ field, widget }, index) => (
        <FormWidgetChrome
          editing={editingId === field.id}
          field={field}
          hovered={hoveredId === field.id}
          key={widget.id}
          onBeginEdit={onBeginEdit}
          onExitEdit={onExitEdit}
          selected={selectedId === field.id}
          tabIndex={index + 1}
          widget={widget}
          zoom={zoom}
        />
      ))}
    </>
  );
};
