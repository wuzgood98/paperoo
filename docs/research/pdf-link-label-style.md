# PDF link label — color and underline on edit

Follow-on to [v5-pdf-link-editing.md](./v5-pdf-link-editing.md). When the visible hyperlink caption changes, preview and export must keep the same fill and underline as the original page content.

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`.

Primary sources: ISO 32000-1 §12.5.6.5 (link annotations), PDF.js `LinkAnnotation` (`annotation.js` v6.3.289), Paperoo `commitPdfLinkLabel`, `PdfTextLayer`, `drawDirtyPdfText`.

---

## What the user sees before edit

The caption is **page content** (text fill + often a separate stroke path), not the link annotation. PDF.js links use `overlaysTextContent` and `overlaidText` for extract only ([v5-pdf-link-editing.md](./v5-pdf-link-editing.md)). `/C` on the link is border color, not caption ink.

Paperoo renders the page with PDF.js (`AnnotationMode.ENABLE`) without the HTML annotation layer, so blue underlined links come from the content stream.

---

## Why label edit loses style

1. **`commitPdfLinkLabel`** updates overlapping `pdfTextObjects` and link `label` / quads ([`store.ts`](../lib/editor/store.ts)).
2. **`isPdfTextDirty`** becomes true → [`PdfTextLayer`](../components/editor/pdf-text-layer.tsx) paints a **white plate** and DOM text using `object.color`.
3. The plate stacks **above** [`PdfAnnotationDirtyBackdrop`](../components/editor/pdf-annotation-layer.tsx) and the canvas ([`editor-overlay.tsx`](../components/editor/editor-overlay.tsx)), hiding blue glyphs and underline vectors.
4. **`object.color`** is often `DEFAULT_PDF_TEXT_COLOR` (`#111827`) when op-list zip fail-closes ([`extract-text-colors.ts`](../lib/pdf/extract-text-colors.ts)).
5. **Vector-based decoration** in [`pdfLinkTextAppearance`](../lib/editor/object-utils.ts) misses hairlines, `path` kinds, and strokes inside form XObjects ([`extract-vectors.ts`](../lib/pdf/extract-vectors.ts) skips `constructPath` when `formDepth > 0`). Neighbor links (e.g. `GitHub | LinkedIn`) stay on the canvas; only the edited caption gets the black plate.

Undo restores history → dirty flags clear → overlays removed → original canvas visible.

---

## Fix (product)

| Piece | Module |
| --- | --- |
| Sample fill + underline from rendered page pixels at commit | [`sample-caption-ink.ts`](../lib/pdf/sample-caption-ink.ts), [`sample-link-caption-from-page.ts`](../lib/pdf/sample-link-caption-from-page.ts) |
| Store on primary run | `captionFill`, `captionUnderline` on [`PdfTextObject`](../lib/editor/types.ts); set in [`commitPdfLinkLabel`](../lib/editor/store.ts) from [`LinkInspector`](../components/editor/pdf-annotation-inspector.tsx) |
| Preview + export | [`pdfLinkTextAppearance`](../lib/editor/object-utils.ts) prefers stored caption ink; [`PdfTextLayer`](../components/editor/pdf-text-layer.tsx), [`drawDirtyPdfText`](../lib/pdf/export-pdf.ts) unchanged entry points |
| Fallback | If sampling returns null, keep vector/zip heuristic |

Do not mutate `originalColor` / `color`. Export worker has no canvas; it relies on stored `captionFill` / `captionUnderline`.

---

## Tests

- [`test/sample-caption-ink.test.ts`](../../test/sample-caption-ink.test.ts) — synthetic RGBA fixtures.
- [`test/object-utils.test.ts`](../../test/object-utils.test.ts) — stored caption overrides heuristics.
- [`test/export-pdf-link.test.ts`](../../test/export-pdf-link.test.ts) — export with sampled caption fields.
