# PDF text font weight after edit

Why bold PDF text goes regular after an edit, and how weight can be recovered from PDF.js without changing the V2 mask-and-redraw model.

This note follows [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md). Primary sources are the paperoo extract / preview / export paths and the installed PDF.js / pdf-lib packages.

Installed versions (same as v2):

- `pdfjs-dist@6.3.289`
- `pdf-lib@1.17.1` / `@pdf-lib/fontkit@1.1.1`

---

## Symptom

Unmodified PDF text stays on the PDF.js canvas, so bold glyphs look correct. After any text (or family/size) change, `isPdfTextDirty` flips ([lib/editor/object-utils.ts](../../lib/editor/object-utils.ts)). The dirty overlay covers the original box and redraws the string. That redraw used regular weight in both preview and export.

Overlay `TextObject` already stores `fontWeight` and is unaffected.

---

## Where weight was dropped

### Type and extract

`PdfTextObject` had no `fontWeight` / `italic` ([lib/editor/types.ts](../../lib/editor/types.ts)). `extractPdfTextObjects` set family, size, and geometry only ([lib/pdf/extract-text.ts](../../lib/pdf/extract-text.ts)).

PDF.js `TextStyle` also has no weight — only `ascent`, `descent`, `vertical`, `fontFamily` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 361–378). The worker builds `textContent.styles[loadedName]` with those four fields (`pdf.worker.mjs` ~35891–35896).

`TextItem.fontName` is the synthetic `loadedName` (e.g. `g_d0_f1`), not the PDF `/BaseFont` ([v2 research](./v2-pdf-text-capabilities.md), worker ~35903). Name heuristics on `fontName` alone cannot detect bold.

### Preview

[components/editor/pdf-text-layer.tsx](../../components/editor/pdf-text-layer.tsx) measured dirty text with `fontWeight: 400` and `italic: false`, and the replacement CSS omitted `fontWeight` / `fontStyle`.

### Export

[lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) `drawDirtyPdfText` called `fontKey(family, 400, false)` and fell back to regular `StandardFonts` (`Helvetica` / `TimesRoman` / `Courier`). Overlay text already used `object.fontWeight` / `object.italic`.

`fontKey` for non-`sans` returned only `family`, ignoring weight and italic — so bold serif/mono needed an explicit `StandardFonts` variant map.

---

## Where PDF.js does know bold

Font objects export `name`, and on system-font fallback also `bold` / `italic` (`EXPORT_DATA_PROPERTIES` in `pdf.worker.mjs` ~26335). Fallback sets:

```js
this.bold = /bold/i.test(fontName);
this.italic = /oblique|italic/i.test(fontName);
```

(`pdf.worker.mjs` ~27215–27216.) Those Font records land on `page.commonObjs` under `loadedName` (`TranslatedFont.send`, ~37517). Paperoo already reads `commonObjs` for images ([lib/pdf/pdf-image-preview.ts](../../lib/pdf/pdf-image-preview.ts)).

Recovery: after `getTextContent()` **and** `getOperatorList()` (fonts are posted to `commonObjs` during operator-list translation via `TranslatedFont.send`, not by text extraction alone), and before `page.cleanup()`, resolve each unique `item.fontName` from `commonObjs`, read face `name` (and `bold` / `italic` when present), map bold → `700` and italic → `true`, store on `PdfTextObject`, and use those fields in dirty preview and export.

Exact embedded-face matching remains a known V2 limit ([v2 research](./v2-pdf-text-capabilities.md)); this only recovers binary weight/italic.

---

## Sources

- Paperoo: [lib/pdf/extract-text.ts](../../lib/pdf/extract-text.ts), [lib/pdf/session.ts](../../lib/pdf/session.ts), [lib/editor/types.ts](../../lib/editor/types.ts), [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts), [components/editor/pdf-text-layer.tsx](../../components/editor/pdf-text-layer.tsx)
- Prior research: [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md)
- PDF.js: `TextStyle` in `api.d.ts`; Font `bold` / `exportData` / TextStyle construction in `pdf.worker.mjs`
- pdf-lib: `StandardFonts` Bold / Italic / BoldItalic variants
