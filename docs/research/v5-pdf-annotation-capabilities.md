# V5 PDF annotation capabilities

What existing-PDF annotation editing can detect, select, and rewrite with the libraries already installed, without flattening annotations into page content.

This note follows [v5-pdf-annotation-editing.md](../../v5-pdf-annotation-editing.md). Research notes live under `docs/research/`, next to [v4-pdf-vector-capabilities.md](./v4-pdf-vector-capabilities.md).

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json))
- `pdf-lib@1.17.1` ([package.json](../../package.json))

Primary sources: installed `pdfjs-dist` / `pdf-lib` source and types. Do not use PDF.js `AnnotationStorage`, `saveDocument()`, or `AnnotationEditorLayer` for Paperoo’s model.

---

## `getAnnotations`

`PDFPageProxy.getAnnotations({ intent })` → `Promise<Array<any>>` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) ~1496–1501). `intent`: `"display"` (default), `"print"`, `"any"`.

Worker builds `data` on `Annotation` subclasses ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) ~53364+). `id` is the indirect ref string (`12R` / `12R0`). `rect` is user space `[xMin, yMin, xMax, yMax]`. `color` is RGB bytes or `null`. `contentsObj` is `{ str, dir }`.

`AnnotationType` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) ~115–143): Link 2, FreeText 3, Highlight 9, Underline 10, Squiggly 11, StrikeOut 12, Stamp 13, Text 1, Popup 16, Widget 20.

Viewability: markup with `quadPoints === null` is omitted from `"display"`. Widgets and popups are parsed; skip them in the editor (`subtype === "Widget"` / `"Popup"`). `"3D"` yields `annotationType === undefined` (enum key is `THREED`).

**Quad points:** 8 numbers per quad, user space; PDF.js normalizes to axis-aligned corners. Markup uses `getQuadPoints(dict, null)`; links pass `rect` and reject out-of-rect quads.

**Links:** Often no `/AP` → empty canvas paint; overlay hit targets required. Fields: `url`, `unsafeUrl`, `dest`, `action` (named only).

**Highlights:** `opacity` from `/CA` on data only (not underline/strikeout/squiggly).

**FreeText:** `defaultAppearanceData` from `/DA`; no `/Q` on free text in this PDF.js version.

---

## Canvas vs extraction

- Render: [render-page.ts](../../lib/pdf/render-page.ts) defaults `AnnotationMode.ENABLE`.
- Operator list: [session.ts](../../lib/pdf/session.ts) uses `AnnotationMode.DISABLE` for text/images/vectors.

---

## pdf-lib export surface

No high-level markup API. Use `PDFPage.node.Annots()`, `removeAnnot(ref)`, `context.delete(ref)`, and `PDFAnnotation.fromDict(dict)` for `Rect` / `AP` / `setNormalAppearance`.

Changing `/C` or `/Contents` without updating `/AP` leaves stale appearance in viewers. For markup color changes, drop `/AP` and rely on `/QuadPoints` + `/C` where viewers synthesize.

`copyPages` preserves edited annotation dicts. Do not use `drawPage` embed for pages that must keep `/Annots`.

---

## Paperoo implementation map

| Stage | Module |
| --- | --- |
| Extract | `lib/pdf/extract-annotations.ts`, `session.ts` |
| Model | `lib/editor/types.ts` → `pdfAnnotationObjects` |
| Select / edit | `overlay-pdf-hit.ts`, `store.ts`, `pdf-annotation-layer.tsx` |
| Export | `lib/pdf/export-annotations.ts` called from `export-pdf.ts` before `copyPages` |

Overlay user highlights (`HighlightObject`) remain page content, not PDF annotations.
