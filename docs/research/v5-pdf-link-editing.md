# V5 PDF link editing

How to change an existing link’s URL and the visible caption in Paperoo, on top of [v5-pdf-annotation-capabilities.md](./v5-pdf-annotation-capabilities.md).

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`.

Primary sources: ISO 32000-1:2008 (same edition as [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md)), installed PDF.js worker, pdf-lib `PDFDict` / `PDFString`.

---

## What a link stores

**ISO 32000-1 §12.5.6.5 Table 173:** `/A` (action) or `/Dest` (destination), not both. Optional `/QuadPoints`, `/H`, `/Rect`.

**§12.5.2 Table 164 / §14.9.3:** `/Contents` is an alternate description (tooltip), not the painted caption.

The visible label is **page content** under `/Rect` or `/QuadPoints`. PDF.js sets `overlaysTextContent` on links and fills `overlaidText` in `getAnnotationsData` (`pdf.worker.mjs`, link class ~55619, data assembly ~59604).

---

## PDF.js fields (Paperoo extract)

| Field               | Use                                                   |
| ------------------- | ----------------------------------------------------- |
| `url` / `unsafeUrl` | External URI (GoToR/Launch may appear as `unsafeUrl`) |
| `dest`              | GoTo destination                                      |
| `action`            | Named action only (`NextPage`, …)                     |
| `overlaidText`      | Visible caption (not yet required for hit-testing)    |
| `contentsObj.str`   | Tooltip only — not edited in V5 link stage            |

---

## pdf-lib writes

No link API. Mutate the annotation `PDFDict` in [export-annotations.ts](../lib/pdf/export-annotations.ts):

- URI: `dict.delete(PDFName.of("Dest"))`; set `/A` with `/S /URI` and `/URI` as **`PDFString.of(url)`** (not `context.obj` for the URI string).
- If `/A` is already a URI dict, update `/URI` in place to preserve `/Next`.
- Label: rewrite dirty `pdfTextObjects` via existing [export-pdf.ts](../lib/pdf/export-pdf.ts) `drawDirtyPdfText`; optionally update `/Rect` and existing `/QuadPoints` when the fitted caption width changes.

---

## Paperoo map

| Concern | Module |
| --- | --- |
| Extract `originalAction`, `label` | `lib/pdf/extract-annotations.ts` |
| Overlap + dirty | `lib/editor/object-utils.ts` |
| Inspector URL + label | `components/editor/pdf-annotation-inspector.tsx` |
| Text patch with link selected | `lib/editor/store.ts` |
| `/A` URI export | `lib/pdf/export-annotations.ts` |
