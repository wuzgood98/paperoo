# V6 PDF AcroForm capabilities

What existing-PDF form filling can detect, edit, and write with the libraries already installed, while keeping interactive AcroForm fields.

This note follows [v6-pdf-acroforms.md](../../v6-pdf-acroforms.md). Research notes live under `docs/research/`, next to [v5-pdf-annotation-capabilities.md](./v5-pdf-annotation-capabilities.md).

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json))
- `pdf-lib@1.17.1` ([package.json](../../package.json))
- `@pdf-lib/fontkit@1.1.1`

Primary sources: installed `pdfjs-dist` / `pdf-lib` source and types. Do not use PDF.js `AnnotationStorage`, `saveDocument()`, or `AnnotationMode.ENABLE_FORMS` for Paperoo’s model.

---

## Field vs widget

An AcroForm field (`/FT`, `/T`, `/V`, `/Ff`) can own several widget annotations (`/Subtype /Widget`, `/Rect` on a page). Fully qualified names are `/T` segments joined with `.` via `/Parent`. Do not treat each widget as its own field.

---

## PDF.js discovery

`PDFDocumentProxy.getFieldObjects()` → `Promise<Map<string, Array<Object>> | null>` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts)). Map key is the fully qualified name. Array length > 1 means multiple widgets or non-terminal nodes.

Worker `getFieldObject()` shapes ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs)):

| `type` | Payload notes |
| --- | --- |
| `"text"` | `value`, `multiline`, `password`, `charLimit`, `comb`, `editable`, `rect`, `page`, `id`. No `required`, no `/Q`. |
| `"checkbox"` / `"radiobutton"` / `"button"` | `exportValues` / `buttonValue`, `value` (`"Off"` when empty). |
| `"combobox"` / `"listbox"` | `value` is **first** selected only. `items: { exportValue, displayValue }[]`. `multipleSelection`. |
| `"signature"` | `value: null`. |
| `""` | Non-terminal: `kidIds`. |

`PDFPageProxy.getAnnotations({ intent: "display" })` still required. Widget `data` includes `fieldFlags`, `readOnly`, `required`, `textAlignment`, `fieldType` (`Tx`/`Btn`/`Ch`/`Sig`), `fieldValue` (choice = **full array**), `options`, `multiLine`, `combo`, `multiSelect`.

`/TU` is `alternativeText` on the annot only — not in `getFieldObjects()`. `/TM` is unread. `hasJSActions()`, `getCalculationOrderIds()`, `getSignatures()`, `isPureXfa` are detection-only.

Paperoo render stays `AnnotationMode.ENABLE` so original `/AP` paints until a dirty HTML cover is shown.

---

## pdf-lib write surface

`PDFDocument.getForm()` → `PDFForm`. Typed getters: `getTextField`, `getCheckBox`, `getRadioGroup`, `getDropdown`, `getOptionList`, `getSignature`.

Values: `setText` / `check` / `uncheck` / `select` / `clear`. `check()` writes the on-name (`getOnValue() ?? Yes`). Flags: `isReadOnly`, `isRequired`, `isMultiline`, `isPassword`, `isCombed`, `getMaxLength`, `isEditable`, `isMultiselect`.

**`getForm()` deletes `/XFA`** (`console.warn` + `deleteXFA()`). Detect `/XFA` on `catalog.AcroForm()` first. Skip `getForm()` when it is present.

`setText` / `check` / `select` only mark dirty. `updateFieldAppearances(font?)` (also run by `save()` if `getForm()` was used on **that** document) rebuilds `/AP`. Default font is Helvetica (WinAnsi). `PDFTextField.setText` calls `disableRichFormatting()`.

`PDFDropdown.getOptions()` returns **display** strings (`display ?? value`). `select("GH")` when display is `"Ghana"` calls `enableEditing()` and stores `"GH"`. Default appearance paints `getSelected()[0]`. Write `/V` with the export value via `acroField.setValues`, then generate appearances that paint the display label. Radio `getOptions()` / `select()` use `/Opt` export strings when present.

`flatten()` exists and must never be called. `PDFSignature` has no value APIs.

---

## Export copy hole

[`PDFDocument.copy`](../../node_modules/pdf-lib/src/api/PDFDocument.ts) documents that it does not copy AcroForms. Paperoo `exportDocument` uses `PDFDocument.create()` + `copyPages`, which drops catalog `/AcroForm` even when page widgets copy.

`PDFObjectCopier` is public. Copy pages and the source `/AcroForm` dict with **one** copier so field refs and widget annots stay the same objects.

pdf-lib `save()` rewrites the file. Existing ByteRange signatures will not verify after export. Do not rewrite signature `/V` or `/AP`.

---

## Paperoo implementation map

| Stage | Module |
| --- | --- |
| Extract | `lib/pdf/extract-forms.ts`, `session.ts` (`getFieldObjects` + widget annots) |
| Model | `lib/editor/types.ts` → `EditorDocument.form` (fields, not widgets-as-objects) |
| Select / edit | `pdf-form-layer.tsx`, `store.ts` `selectedPdfFormFieldId` |
| Export | `lib/pdf/export-forms.ts` on source, then one copier for pages + AcroForm |

Widget annots stay skipped in `extract-annotations.ts` (`subtype === "Widget"`).

Editor tab order is the field list, then widgets on the current page. PDF `/Tabs` R/C/S (row, column, structure) is not implemented.

Unsupported: XFA fill, PDF JavaScript, cryptographic signing, rich-text / file-select / push-button editing, `/TU` `/TM`, field geometry authoring, original appearance fonts, `/Tabs` R/C/S order.
