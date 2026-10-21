"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  RefObject,
} from "react";

import { objectWrapperStyle, pageToCss } from "@/lib/editor/coordinates";
import {
  autoCombFontSize,
  autoFormFontSize,
  FORM_TEXT_PADDING,
  formLineHeight,
  formTextBounds,
} from "@/lib/editor/form-appearance";
import type { MeasureText } from "@/lib/editor/form-appearance";
import {
  adjacentPdfFormWidget,
  documentForm,
  isPdfFormFieldDirty,
  isPdfFormFieldEditable,
  nextCheckboxValue,
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
import { canvasTextWidth, fontFamilyCss } from "@/lib/fonts/measure-text";
import { cn } from "@/lib/utils";

const LISTBOX_MAX_VISIBLE_OPTIONS = 8;
const LISTBOX_MIN_VISIBLE_OPTIONS = 2;

const startsInlineEdit = (field: PdfFormField): boolean =>
  field.kind === "text" ||
  field.kind === "dropdown" ||
  field.kind === "listbox";

const widgetBoxStyle = (widget: PdfFormWidget, zoom: number) =>
  objectWrapperStyle({ ...widget, rotation: 0 }, zoom);

/** pdf-lib's border when a widget predates recorded widths (old sessions). */
const DEFAULT_BORDER_WIDTH = 1;
/** A checkbox tick fills this much of its box. */
const CHECK_MARK_FILL = 0.8;

const measureSans: MeasureText = (text, fontSize) =>
  canvasTextWidth(text, {
    fontFamily: "sans",
    fontSize,
    fontWeight: 400,
    italic: false,
  });

const borderOf = (widget: PdfFormWidget): number =>
  widget.borderWidth ?? DEFAULT_BORDER_WIDTH;

const combCellsOf = (field: PdfFormField): number | null =>
  field.kind === "text" && field.comb && field.maxLength
    ? field.maxLength
    : null;

const isMultiline = (field: PdfFormField): boolean =>
  field.kind === "listbox" || (field.kind === "text" && field.multiline);

/** The size export draws this text at: the PDF's own, or pdf-lib's fit-to-box size. */
const formFontSize = (
  field: PdfFormField,
  widget: PdfFormWidget,
  text: string
): number => {
  const fixed = widget.fontSize ?? 0;
  if (fixed > 0) {
    return fixed;
  }
  const cells = combCellsOf(field);
  const bounds = formTextBounds(widget, borderOf(widget), cells !== null);
  if (cells !== null) {
    return autoCombFontSize(text, bounds, cells, measureSans);
  }
  if (field.kind === "listbox") {
    // pdf-lib sizes a list box so every option fits, selected or not.
    const options = field.options.map((option) => option.display);
    return autoFormFontSize(options, bounds, measureSans, true);
  }
  if (isMultiline(field)) {
    return autoFormFontSize(text.split("\n"), bounds, measureSans, true);
  }
  return autoFormFontSize(
    [text.replaceAll("\n", " ")],
    bounds,
    measureSans,
    false
  );
};

/**
 * Text placed where export draws it: inside the border, Helvetica-sized
 * (Liberation Sans has its widths), at the size export will pick.
 */
const formTextStyle = (
  field: PdfFormField,
  widget: PdfFormWidget,
  zoom: number,
  text: string
): CSSProperties => {
  const border = pageToCss(borderOf(widget), zoom);
  const cells = combCellsOf(field);
  const fontSize = pageToCss(formFontSize(field, widget, text), zoom);
  const style: CSSProperties = {
    fontFamily: fontFamilyCss("sans"),
    fontSize,
    height: `calc(100% - ${border * 2}px)`,
    left: border,
    lineHeight: isMultiline(field) ? formLineHeight(1) : 1,
    padding: cells === null ? pageToCss(FORM_TEXT_PADDING, zoom) : 0,
    textAlign: field.kind === "text" ? field.align : "left",
    top: border,
    width: `calc(100% - ${border * 2}px)`,
  };
  if (cells === null) {
    return style;
  }
  // While typing a comb field, spread a monospace font across the cells.
  const cell = (widget.width * zoom - border * 2) / cells;
  return {
    ...style,
    fontFamily: fontFamilyCss("mono"),
    letterSpacing: `calc(${cell}px - 1ch)`,
    paddingLeft: `calc((${cell}px - 1ch) / 2)`,
    textAlign: "left",
  };
};

/** A page scrolled into view mounts its widgets within a few frames. */
const FOCUS_WIDGET_MAX_FRAMES = 30;

const patchSelectedField = (updater: (field: PdfFormField) => PdfFormField) => {
  editorStore.patchPdfFormField(updater);
};

const widgetButton = (widgetId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-form-widget="${CSS.escape(widgetId)}"]`
  );

/**
 * Focus the next or previous fillable widget in the document, scrolling its
 * page into view first. False past either end, so Tab can leave the form.
 */
const focusAdjacentWidget = (widgetId: string, step: 1 | -1): boolean => {
  const { document: editorDocument } = editorStore.getState();
  const target = adjacentPdfFormWidget(
    documentForm(editorDocument),
    editorDocument.pages.map((page) => page.id),
    widgetId,
    step
  );
  if (!target) {
    return false;
  }
  editorStore.setCurrentPage(target.widget.pageId, { syncFitZoom: false });
  let frames = 0;
  const tryFocus = (): void => {
    const node = widgetButton(target.widget.id);
    if (node) {
      node.focus();
      return;
    }
    frames += 1;
    if (frames < FOCUS_WIDGET_MAX_FRAMES) {
      window.requestAnimationFrame(tryFocus);
    }
  };
  tryFocus();
  return true;
};

/** Tab and Shift+Tab move between fields across pages, not DOM order. */
const handleTabKey = (event: KeyboardEvent<HTMLElement>, widgetId: string) => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (focusAdjacentWidget(widgetId, event.shiftKey ? -1 : 1)) {
    event.preventDefault();
  }
};

/** pdf-lib's highlight behind a list box's selected options. */
const LIST_SELECTED_COLOR = "rgb(153 193 218)";
const PLATE_CLASS =
  "pointer-events-none absolute overflow-hidden bg-white text-[#111827]";

/** Radios draw their own circle: a plate inside the box would cut the PDF's. */
const RadioPlate = ({
  on,
  widget,
  zoom,
}: {
  on: boolean;
  widget: PdfFormWidget;
  zoom: number;
}) => (
  <div
    className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-white"
    style={{
      border: `${Math.max(1, pageToCss(borderOf(widget), zoom))}px solid #111827`,
    }}
  >
    {on ? <span className="size-1/2 rounded-full bg-[#111827]" /> : null}
  </div>
);

const CombPlate = ({
  cells,
  field,
  preview,
  widget,
  zoom,
}: {
  cells: number;
  field: PdfFormField;
  preview: string;
  widget: PdfFormWidget;
  zoom: number;
}) => {
  const letters = [...preview];
  return (
    <div
      className={cn(PLATE_CLASS, "flex items-center")}
      style={{
        ...formTextStyle(field, widget, zoom, preview),
        fontFamily: fontFamilyCss("sans"),
        letterSpacing: "normal",
        paddingLeft: 0,
      }}
    >
      {Array.from({ length: cells }, (_, cell) => (
        <span className="flex-1 text-center" key={`cell-${cell}`}>
          {letters[cell] ?? ""}
        </span>
      ))}
    </div>
  );
};

/** Covers the PDF's drawing of a filled field with the value export will draw. */
const FormCoverPlate = ({
  field,
  preview,
  widget,
  zoom,
}: {
  field: PdfFormField;
  preview: string;
  widget: PdfFormWidget;
  zoom: number;
}) => {
  if (field.kind === "radio") {
    return <RadioPlate on={preview.length > 0} widget={widget} zoom={zoom} />;
  }
  if (field.kind === "checkbox") {
    // Inside the border, so the PDF's own box stays.
    return (
      <div
        className={cn(PLATE_CLASS, "flex items-center justify-center")}
        style={{
          ...formTextStyle(field, widget, zoom, ""),
          fontSize: pageToCss(widget.height * CHECK_MARK_FILL, zoom),
          padding: 0,
        }}
      >
        {preview}
      </div>
    );
  }
  const cells = combCellsOf(field);
  if (cells !== null) {
    return (
      <CombPlate
        cells={cells}
        field={field}
        preview={preview}
        widget={widget}
        zoom={zoom}
      />
    );
  }
  const style = formTextStyle(field, widget, zoom, preview);
  if (field.kind === "listbox") {
    return (
      <div className={PLATE_CLASS} style={style}>
        {field.options.map((option) => (
          <div
            key={option.exportValue}
            style={
              field.value.includes(option.exportValue)
                ? { backgroundColor: LIST_SELECTED_COLOR }
                : undefined
            }
          >
            {option.display}
          </div>
        ))}
      </div>
    );
  }
  if (isMultiline(field)) {
    return (
      <div className={cn(PLATE_CLASS, "whitespace-pre-wrap")} style={style}>
        {preview}
      </div>
    );
  }
  return (
    <div className={cn(PLATE_CLASS, "flex items-center")} style={style}>
      <div className="w-full overflow-hidden whitespace-pre">{preview}</div>
    </div>
  );
};

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
    // Moving focus blurs this input, which commits the value.
    handleTabKey(event, widget.id);
    if (event.defaultPrevented) {
      return;
    }
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
      "absolute resize-none border-0 bg-white text-[#111827] outline-none",
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
    style: formTextStyle(field, widget, zoom, value),
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

interface ChoiceControlProps {
  onExit: () => void;
  /** Opened by a click, so the option list opens too. */
  openPicker: boolean;
  widget: PdfFormWidget;
  zoom: number;
}

/** Focus a control as it opens, and open a dropdown's list on a click. */
const useFocusOnOpen = (
  ref: RefObject<HTMLInputElement | HTMLSelectElement | null>,
  openPicker: boolean
): void => {
  useEffect(() => {
    const control = ref.current;
    if (!control) {
      return;
    }
    control.focus({ preventScroll: true });
    if (!(openPicker && "showPicker" in control)) {
      return;
    }
    try {
      control.showPicker();
    } catch {
      // Some browsers refuse a picker here; the control is focused anyway.
    }
    // openPicker only changes while closed, so this runs once per open.
  }, [openPicker, ref]);
};

/** Escape closes the control; Tab moves to the next field. */
const choiceKeyDown = (
  event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  widgetId: string,
  onEscape: () => void
): void => {
  handleTabKey(event, widgetId);
  if (!event.defaultPrevented && event.key === "Escape") {
    event.preventDefault();
    onEscape();
    event.currentTarget.blur();
  }
};

const commitDropdownValue = (
  field: PdfFormDropdownField,
  exportValue: string
): void => {
  if (exportValue === (field.value ?? "")) {
    return;
  }
  patchSelectedField((current) =>
    current.kind === "dropdown" && current.id === field.id
      ? { ...current, value: exportValue.length > 0 ? exportValue : null }
      : current
  );
};

const FormComboControl = ({
  field,
  onExit,
  openPicker,
  widget,
  zoom,
}: ChoiceControlProps & { field: PdfFormDropdownField }) => {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef(false);
  useFocusOnOpen(inputRef, openPicker);
  const displayValue =
    pdfFormChoiceDisplay(field.options, field.value) || (field.value ?? "");

  return (
    <>
      <input
        aria-label={field.name}
        autoComplete="off"
        className="absolute border-0 bg-white text-[#111827] outline-none"
        defaultValue={displayValue}
        list={listId}
        onBlur={(event) => {
          if (discardRef.current) {
            discardRef.current = false;
            onExit();
            return;
          }
          const typed = event.currentTarget.value;
          const match = field.options.find(
            (option) => option.display === typed || option.exportValue === typed
          );
          commitDropdownValue(field, match?.exportValue ?? typed);
          onExit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }
          choiceKeyDown(event, widget.id, () => {
            discardRef.current = true;
          });
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        ref={inputRef}
        style={formTextStyle(field, widget, zoom, displayValue)}
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
};

const FormDropdownControl = ({
  field,
  onExit,
  openPicker,
  widget,
  zoom,
}: ChoiceControlProps & { field: PdfFormDropdownField }) => {
  const selectRef = useRef<HTMLSelectElement>(null);
  useFocusOnOpen(selectRef, openPicker);

  return (
    <select
      aria-label={field.name}
      className="absolute border-0 bg-white text-[#111827] outline-none"
      onBlur={onExit}
      onChange={(event) => {
        commitDropdownValue(field, event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        choiceKeyDown(event, widget.id, onExit);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      ref={selectRef}
      style={formTextStyle(
        field,
        widget,
        zoom,
        pdfFormChoiceDisplay(field.options, field.value)
      )}
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
  onExit,
  widget,
  zoom,
}: Omit<ChoiceControlProps, "openPicker"> & { field: PdfFormListboxField }) => {
  const selectRef = useRef<HTMLSelectElement>(null);
  useFocusOnOpen(selectRef, false);

  return (
    <select
      aria-label={field.name}
      className="absolute border-0 bg-white text-[#111827] outline-none"
      multiple={field.multiSelect}
      onBlur={onExit}
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
      onKeyDown={(event) => {
        choiceKeyDown(event, widget.id, onExit);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      ref={selectRef}
      size={Math.max(
        LISTBOX_MIN_VISIBLE_OPTIONS,
        Math.min(field.options.length, LISTBOX_MAX_VISIBLE_OPTIONS)
      )}
      style={formTextStyle(field, widget, zoom, "")}
      value={field.multiSelect ? field.value : (field.value[0] ?? "")}
    >
      {field.options.map((option) => (
        <option key={option.exportValue} value={option.exportValue}>
          {option.display}
        </option>
      ))}
    </select>
  );
};

const activateWidget = (field: PdfFormField, widget: PdfFormWidget): void => {
  editorStore.selectPdfFormField(field.id);
  if (!isPdfFormFieldEditable(field)) {
    return;
  }
  if (field.kind === "checkbox") {
    patchSelectedField((current) =>
      current.kind === "checkbox" && current.id === field.id
        ? { ...current, value: nextCheckboxValue(current, widget) }
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
  widget,
  zoom,
}: {
  editing: boolean;
  field: PdfFormField;
  hovered: boolean;
  onBeginEdit: (fieldId: string) => void;
  onExitEdit: () => void;
  selected: boolean;
  widget: PdfFormWidget;
  zoom: number;
}) => {
  // A click opens a dropdown's list too; Tab only focuses it.
  const [openedByPointer, setOpenedByPointer] = useState(false);
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
  const exitControl = (): void => {
    setOpenedByPointer(false);
    onExitEdit();
  };

  return (
    <div
      className={cn("absolute origin-center", chromeClass)}
      style={widgetBoxStyle(widget, zoom)}
    >
      {dirty && !showControl ? (
        <FormCoverPlate
          field={field}
          preview={preview}
          widget={widget}
          zoom={zoom}
        />
      ) : null}
      {showControl && field.kind === "text" ? (
        <FormTextControl
          field={field}
          onExit={exitControl}
          widget={widget}
          zoom={zoom}
        />
      ) : null}
      {showControl && field.kind === "dropdown" && field.editable ? (
        <FormComboControl
          field={field}
          onExit={exitControl}
          openPicker={openedByPointer}
          widget={widget}
          zoom={zoom}
        />
      ) : null}
      {showControl && field.kind === "dropdown" && !field.editable ? (
        <FormDropdownControl
          field={field}
          onExit={exitControl}
          openPicker={openedByPointer}
          widget={widget}
          zoom={zoom}
        />
      ) : null}
      {showControl && field.kind === "listbox" ? (
        <FormListboxControl
          field={field}
          onExit={exitControl}
          widget={widget}
          zoom={zoom}
        />
      ) : null}
      {showControl ? null : (
        <button
          aria-label={field.name}
          className="absolute inset-0 cursor-text bg-transparent"
          data-form-widget={widget.id}
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
          onKeyDown={(event) => {
            handleTabKey(event, widget.id);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            setOpenedByPointer(true);
          }}
          // Tab skips fields with nothing to fill; a click still selects them.
          tabIndex={editable ? 0 : -1}
          type="button"
        />
      )}
    </div>
  );
};

const PdfFormLayerView = ({
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
  // Only the form: edits to page content must not re-render form widgets.
  const form = useEditorStore((state) => state.document.form);
  const items = pdfFormWidgetsOnPage({ form }, pageId);

  return (
    <>
      {items.map(({ field, widget }) => (
        <FormWidgetChrome
          // Selecting anything else closes an open control.
          editing={editingId === field.id && selectedId === field.id}
          field={field}
          hovered={hoveredId === field.id}
          key={widget.id}
          onBeginEdit={onBeginEdit}
          onExitEdit={onExitEdit}
          selected={selectedId === field.id}
          widget={widget}
          zoom={zoom}
        />
      ))}
    </>
  );
};

/** Memoized: the overlay re-renders on hover and selection changes this layer may not use. */
export const PdfFormLayer = memo(PdfFormLayerView);
