import { userBoxToDisplayed } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import { DEFAULT_CHECKBOX_ON_STATE } from "@/lib/editor/types";
import type {
  CropBox,
  PageRotation,
  PdfFormChoiceOption,
  PdfFormField,
  PdfFormModel,
  PdfFormWidget,
  Rect,
  TextAlign,
} from "@/lib/editor/types";

/* oxlint-disable anti-slop/no-unknown-parameters -- PDF.js widget annot I/O */
/* oxlint-disable anti-slop/no-runtime-typeof -- PDF.js widget annot I/O */

export interface ExtractFormPage {
  cropBox: CropBox;
  id: string;
  sourceRotate: PageRotation;
}

export interface ExtractFormInput {
  hasJavaScript: boolean;
  hasXfa: boolean;
  pages: readonly {
    annotations: readonly unknown[];
    page: ExtractFormPage;
  }[];
  signatures: readonly { fieldName?: unknown }[];
}

const FIELD_FLAG = {
  COMB: 0x01_00_00_00,
  COMBO: 0x00_02_00_00,
  EDIT: 0x00_04_00_00,
  FILESELECT: 0x00_10_00_00,
  MULTILINE: 0x00_00_10_00,
  MULTISELECT: 0x00_20_00_00,
  PASSWORD: 0x00_00_20_00,
  RADIO: 0x00_00_80_00,
  READONLY: 0x00_00_00_01,
  REQUIRED: 0x00_00_00_02,
  RICHTEXT: 0x02_00_00_00,
} as const;

/** Annotation /F bits that keep a widget off screen. */
const ANNOTATION_FLAG = {
  HIDDEN: 0x02,
  NO_VIEW: 0x20,
} as const;

interface PdfJsChoiceItem {
  displayValue?: unknown;
  exportValue?: unknown;
}

interface PdfJsWidget {
  annotationFlags?: unknown;
  borderColor?: unknown;
  borderStyle?: unknown;
  buttonValue?: unknown;
  checkBox?: unknown;
  combo?: unknown;
  defaultAppearanceData?: unknown;
  exportValue?: unknown;
  exportValues?: unknown;
  fieldFlags?: unknown;
  fieldName?: unknown;
  fieldType?: unknown;
  fieldValue?: unknown;
  hidden?: unknown;
  id?: unknown;
  maxLen?: unknown;
  multiLine?: unknown;
  multiSelect?: unknown;
  options?: unknown;
  password?: unknown;
  pushButton?: unknown;
  radioButton?: unknown;
  readOnly?: unknown;
  rect?: unknown;
  required?: unknown;
  subtype?: unknown;
  textAlignment?: unknown;
}

const asRecord = (value: unknown): PdfJsWidget | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  // SAFETY: PDF.js widget annots are plain objects; missing keys stay undefined.
  return value as PdfJsWidget;
};

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// oxlint-disable-next-line eslint/no-bitwise -- AcroForm /Ff is a bitmask.
const hasFlag = (flags: number, flag: number): boolean => (flags & flag) !== 0;

const userRectFromPdfRect = (rect: number[]): Rect => {
  const [x1, y1, x2, y2] = rect;
  return {
    height: Math.abs((y2 ?? 0) - (y1 ?? 0)),
    width: Math.abs((x2 ?? 0) - (x1 ?? 0)),
    x: Math.min(x1 ?? 0, x2 ?? 0),
    y: Math.min(y1 ?? 0, y2 ?? 0),
  };
};

const alignFromQuadding = (value: number | null): TextAlign => {
  if (value === 1) {
    return "center";
  }
  if (value === 2) {
    return "right";
  }
  return "left";
};

const decodeChoiceValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter((item): item is string => item !== null);
  }
  const single = asString(value);
  return single === null || single.length === 0 ? [] : [single];
};

const choiceOptions = (raw: PdfJsWidget): PdfFormChoiceOption[] => {
  if (!Array.isArray(raw.options)) {
    return [];
  }
  const options: PdfFormChoiceOption[] = [];
  for (const item of raw.options) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    // SAFETY: PDF.js choice option entries are { displayValue, exportValue } objects.
    const choice = item as PdfJsChoiceItem;
    const exportValue = asString(choice.exportValue) ?? "";
    const display = asString(choice.displayValue) ?? exportValue;
    if (exportValue.length === 0 && display.length === 0) {
      continue;
    }
    options.push({
      display,
      exportValue: exportValue.length > 0 ? exportValue : display,
    });
  }
  return options;
};

const widgetExportValue = (raw: PdfJsWidget): string | null => {
  if (raw.radioButton === true) {
    return asString(raw.buttonValue) ?? asString(raw.exportValue);
  }
  if (raw.checkBox === true) {
    return (
      asString(raw.exportValue) ??
      asString(raw.exportValues) ??
      DEFAULT_CHECKBOX_ON_STATE
    );
  }
  return null;
};

const isCheckedValue = (value: unknown): boolean => {
  if (value === true) {
    return true;
  }
  const named = asString(value);
  return named !== null && named !== "Off" && named.length > 0;
};

/** Hidden and NoView widgets are not shown by any viewer, so not here either. */
const isHiddenWidget = (raw: PdfJsWidget): boolean => {
  const flags = asNumber(raw.annotationFlags) ?? 0;
  return (
    raw.hidden === true ||
    hasFlag(flags, ANNOTATION_FLAG.HIDDEN) ||
    hasFlag(flags, ANNOTATION_FLAG.NO_VIEW)
  );
};

const classify = (
  raw: PdfJsWidget
): PdfFormField["kind"] | "push-button" | null => {
  if (raw.pushButton === true) {
    return "push-button";
  }
  if (raw.radioButton === true) {
    return "radio";
  }
  if (raw.checkBox === true) {
    return "checkbox";
  }
  const fieldType = asString(raw.fieldType);
  if (fieldType === "Sig") {
    return "signature";
  }
  if (fieldType === "Ch") {
    const combo =
      raw.combo === true ||
      hasFlag(asNumber(raw.fieldFlags) ?? 0, FIELD_FLAG.COMBO);
    return combo ? "dropdown" : "listbox";
  }
  if (fieldType === "Tx") {
    return "text";
  }
  if (fieldType === "Btn") {
    return "push-button";
  }
  return null;
};

interface GroupedWidgets {
  kind: PdfFormField["kind"];
  name: string;
  widgets: { page: ExtractFormPage; raw: PdfJsWidget }[];
}

/** PDF.js `borderStyle` and `defaultAppearanceData`: the parts read here. */
interface PdfJsWidgetStyle {
  fontSize?: unknown;
  width?: unknown;
}

const asStyle = (value: unknown): PdfJsWidgetStyle | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  // SAFETY: PDF.js style records are plain objects; missing keys stay undefined.
  return value as PdfJsWidgetStyle;
};

/** PDF.js keeps a border width even when no border colour draws it. */
const widgetBorderWidth = (raw: PdfJsWidget): number =>
  raw.borderColor ? (asNumber(asStyle(raw.borderStyle)?.width) ?? 1) : 0;

const toWidget = (
  raw: PdfJsWidget,
  page: ExtractFormPage
): PdfFormWidget | null => {
  const id = asString(raw.id);
  if (!id || !Array.isArray(raw.rect) || raw.rect.length < 4) {
    return null;
  }
  const rect = raw.rect.map((value) => asNumber(value) ?? 0);
  const displayed = userBoxToDisplayed(
    userRectFromPdfRect(rect),
    page.cropBox,
    page.sourceRotate
  );
  return {
    borderWidth: widgetBorderWidth(raw),
    exportValue: widgetExportValue(raw),
    fontSize: asNumber(asStyle(raw.defaultAppearanceData)?.fontSize) ?? 0,
    height: displayed.height,
    id: createId(),
    pageId: page.id,
    sourceAnnotId: id,
    width: displayed.width,
    x: displayed.x,
    y: displayed.y,
  };
};

/**
 * The checked on-state, read from every widget: PDF.js may report the value
 * on the checked widget only. A value naming a widget's on-state wins.
 */
const checkboxValue = (group: GroupedWidgets): string | null => {
  const onStates = new Set(
    group.widgets.map((item) => widgetExportValue(item.raw))
  );
  const named = group.widgets
    .map((item) => asString(item.raw.fieldValue))
    .find((value) => value !== null && onStates.has(value));
  if (named) {
    return named;
  }
  const checked = group.widgets.find((item) =>
    isCheckedValue(item.raw.fieldValue)
  );
  return checked ? widgetExportValue(checked.raw) : null;
};

// oxlint-disable-next-line eslint/complexity -- one constructor per PDF field kind
const fieldFromGroup = (group: GroupedWidgets): PdfFormField | null => {
  const [first] = group.widgets;
  if (!first) {
    return null;
  }
  const widgets = group.widgets
    .map((item) => toWidget(item.raw, item.page))
    .filter((item): item is PdfFormWidget => item !== null);
  if (widgets.length === 0) {
    return null;
  }
  const { raw } = first;
  const flags = asNumber(raw.fieldFlags) ?? 0;
  const readOnly = raw.readOnly === true || hasFlag(flags, FIELD_FLAG.READONLY);
  const required = raw.required === true || hasFlag(flags, FIELD_FLAG.REQUIRED);
  const base = {
    id: createId(),
    name: group.name,
    readOnly,
    required,
    widgets,
  };
  switch (group.kind) {
    case "text": {
      const fileSelect = hasFlag(flags, FIELD_FLAG.FILESELECT);
      const richText = hasFlag(flags, FIELD_FLAG.RICHTEXT);
      const maxLen = asNumber(raw.maxLen);
      const value = asString(raw.fieldValue) ?? "";
      return {
        ...base,
        align: alignFromQuadding(asNumber(raw.textAlignment)),
        comb: raw.multiLine !== true && hasFlag(flags, FIELD_FLAG.COMB),
        fileSelect,
        kind: "text",
        maxLength: maxLen !== null && maxLen > 0 ? maxLen : null,
        multiline:
          raw.multiLine === true || hasFlag(flags, FIELD_FLAG.MULTILINE),
        originalValue: value,
        password: raw.password === true || hasFlag(flags, FIELD_FLAG.PASSWORD),
        readOnly: readOnly || fileSelect || richText,
        richText,
        value,
      };
    }
    case "checkbox": {
      const value = checkboxValue(group);
      return {
        ...base,
        kind: "checkbox",
        originalValue: value,
        value,
      };
    }
    case "radio": {
      const options = group.widgets.map((item) => {
        const exportValue = widgetExportValue(item.raw) ?? "";
        return { display: exportValue, exportValue };
      });
      const selected = asString(raw.fieldValue);
      const value = selected === null || selected === "Off" ? null : selected;
      return {
        ...base,
        kind: "radio",
        options,
        originalValue: value,
        value,
      };
    }
    case "dropdown": {
      const options = choiceOptions(raw);
      const [selected] = decodeChoiceValue(raw.fieldValue);
      const value = selected ?? null;
      return {
        ...base,
        editable: hasFlag(flags, FIELD_FLAG.EDIT),
        kind: "dropdown",
        options,
        originalValue: value,
        value,
      };
    }
    case "listbox": {
      const options = choiceOptions(raw);
      const value = decodeChoiceValue(raw.fieldValue);
      return {
        ...base,
        kind: "listbox",
        multiSelect:
          raw.multiSelect === true || hasFlag(flags, FIELD_FLAG.MULTISELECT),
        options,
        originalValue: value,
        value,
      };
    }
    case "signature": {
      return {
        ...base,
        kind: "signature",
        readOnly: true,
      };
    }
    default: {
      return null;
    }
  }
};

/** Fields keep widget encounter order per page. PDF /Tabs R, C, and S are unused. */
export const extractPdfForm = (input: ExtractFormInput): PdfFormModel => {
  const signatures = input.signatures
    .map((item) => asString(item.fieldName))
    .filter((name): name is string => name !== null)
    .map((fieldName) => ({ fieldName }));

  if (input.hasXfa) {
    return {
      fields: [],
      hasJavaScript: input.hasJavaScript,
      hasXfa: true,
      signatures,
    };
  }

  const groups = new Map<string, GroupedWidgets>();
  for (const { annotations, page } of input.pages) {
    for (const annotation of annotations) {
      const raw = asRecord(annotation);
      if (!raw || asString(raw.subtype) !== "Widget" || isHiddenWidget(raw)) {
        continue;
      }
      const kind = classify(raw);
      if (kind === null || kind === "push-button") {
        continue;
      }
      const name = asString(raw.fieldName);
      if (name === null || name.length === 0) {
        continue;
      }
      const existing = groups.get(name);
      if (existing) {
        existing.widgets.push({ page, raw });
        continue;
      }
      groups.set(name, { kind, name, widgets: [{ page, raw }] });
    }
  }

  const fields: PdfFormField[] = [];
  for (const group of groups.values()) {
    const field = fieldFromGroup(group);
    if (field) {
      fields.push(field);
    }
  }

  return {
    fields,
    hasJavaScript: input.hasJavaScript,
    hasXfa: false,
    signatures,
  };
};
