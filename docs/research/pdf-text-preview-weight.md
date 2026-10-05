# PDF text preview weight on select / type

Why selected or edited PDF text looks lighter in the editor while export keeps the correct bold weight.

This note follows [pdf-text-font-weight.md](./pdf-text-font-weight.md) and [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md). Primary sources are the paperoo PDF text layer, inspector, font CSS, and export embed path.

---

## Symptom

- **Select / hover:** outline geometry can jump relative to PDF.js glyphs; the inspector text field shows the run in the UI face (Geist) at regular weight.
- **Typing:** dirty overlay whites out the canvas and redraws with CSS Liberation; that can read as a light face even when `fontWeight: 700` is set.
- **Export:** embeds Liberation Bold / StandardFonts Bold via `embedFontForStyle` — looks correct.

Selection alone does **not** mark dirty or swap canvas glyphs ([`selectPdfText`](../../lib/editor/store.ts)).

---

## Select: chrome remasures with Liberation

[`PdfTextLayer`](../../components/editor/pdf-text-layer.tsx) sized hover/selection chrome with `fittedPdfTextFrame` → `canvasTextWidth` using `"Liberation Sans"` ([`fontFamilyCss`](../../lib/fonts/measure-text.ts)). Clean runs should keep the extracted PDF box (`x` / `y` / `width` / `height`). Remeasuring against Liberation changes outline width vs canvas glyphs so selected text looks restyled. Dirty fitting (`max(original, measured)`) is only appropriate after the white cover replaces the glyphs.

Chrome is outline-only (no white fill). It cannot restyle canvas ink; the misfit outline is a geometry cue, not a font swap.

---

## Typing: CSS overlay vs export embed

`isPdfTextDirty` flips on text / family / size change ([`object-utils.ts`](../../lib/editor/object-utils.ts)). Dirty UI covers the PDF.js paint and redraws with CSS `fontFamily` + `fontWeight`. Export embeds the same Liberation files listed in [`FONT_FILES`](../../lib/fonts/measure-text.ts) (or StandardFonts Bold for serif/mono).

`@font-face` for Liberation Regular/Bold/Italic/BoldItalic lives in [`app/globals.css`](../../app/globals.css). Nothing awaited `document.fonts.load` before the dirty overlay painted, so the first paint could use Regular or weak faux-bold while export still embedded Bold bytes.

---

## Inspector Input: unstyled Geist

[`PdfTextInspector`](../../components/editor/pdf-text-inspector.tsx) text `Input` inherited the app sans (Geist) at regular weight — no `fontFamilyCss` / `fontWeight` / `italic` from the selected `PdfTextObject`. On select, the bar showed a light UI face while the canvas stayed bold PDF.js.

Spurious `onValueChange` for size/family that rewrote the same values could also flip dirty on mount; patches should only commit when the value actually changes.

---

## Fix direction

1. Clean chrome uses the source PDF box; Liberation fit only when dirty.
2. Preload Liberation faces (`ensureEditorFonts`) before / when dirty paint runs.
3. Style the inspector text Input with the run’s family, weight, and italic.
4. Guard size/family inspector patches against no-ops.

Exact embedded-face matching remains a V2 limit; this only aligns preview geometry and CSS bold loading with export.

---

## Sources

- [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx)
- [`components/editor/pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx)
- [`lib/fonts/measure-text.ts`](../../lib/fonts/measure-text.ts)
- [`app/globals.css`](../../app/globals.css) (`@font-face` Liberation)
- [`lib/pdf/export-pdf.ts`](../../lib/pdf/export-pdf.ts) (`embedFontForStyle`)
- Prior: [pdf-text-font-weight.md](./pdf-text-font-weight.md)
