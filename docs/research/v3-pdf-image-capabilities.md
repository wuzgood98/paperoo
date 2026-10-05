# V3 PDF image capabilities

What the first existing-image-editing milestone can extract, select, and rewrite with the libraries already installed: click an image that is already in the PDF, move / resize / replace / delete it, export, without rewriting the overlay editor.

This note follows [v3-existing-image-editing-prompt.md](../../v3-existing-image-editing-prompt.md). It records extraction, coordinate mapping, and export limits. It does not implement the editor.

Research notes live under `docs/research/`, next to [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md).

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json), [pdfjs-dist/package.json](../../node_modules/pdfjs-dist/package.json))
- `pdf-lib@1.17.1` ([package.json](../../package.json))

Primary sources are the installed package types and source, Mozilla’s PDF.js API docs, pdf-lib’s embedder source, and ISO 32000-1:2008 (PDF). Secondary write-ups are not used.

---

## There is no `getTextContent` for images

`PDFPageProxy.getTextContent` returns glyph runs only ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1545–1553). Image placement is not on `TextItem`.

`PDFPageProxy.getOperatorList({ intent, annotationMode, … })` returns a `Promise<PDFOperatorList>` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1531–1536, 1390–1408).

`PDFOperatorList` is ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1440–1446):

| Field       | Meaning                                 |
| ----------- | --------------------------------------- |
| `fnArray`   | Operator function ids (`OPS.*` numbers) |
| `argsArray` | Arguments for each operator             |

There is no helper that returns a placed rectangle. Walk the list and compose the CTM.

`render({ recordImages: true })` can fill `PDFPageProxy.imageCoordinates` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1378–1379 and 1463). That field is typed `any` and only exists after a canvas render. Do not use it for extraction.

---

## Operator ids that matter

`OPS` is exported from the public build ([pdf.d.ts](../../node_modules/pdfjs-dist/types/src/pdf.d.ts) line 44) and defined in [util.d.ts](../../node_modules/pdfjs-dist/types/src/shared/util.d.ts) lines 228–323.

| `OPS` | Role |
| --- | --- |
| `save` / `restore` | Graphics-state stack (`q` / `Q`) |
| `transform` | Multiply the CTM (`cm`) |
| `paintFormXObjectBegin` / `paintFormXObjectEnd` | Nested form XObject (push / apply matrix / pop) |
| `paintImageXObject` | Named image XObject (`Do`) |
| `paintInlineImageXObject` | Inline image |
| `paintImageXObjectRepeat` | Tiled / repeated paints |
| `paintImageMaskXObject`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintSolidColorImageMask` | Image masks, not selectable photos |
| `clip` / `eoClip` | Clip is active until the matching restore |

The worker emits `paintImageXObject` as `[objId, pixelWidth, pixelHeight]` ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) `buildPaintImageXObject`). Those width/height values are dictionary pixels, not on-page size. `CanvasGraphics.paintImageXObject(opIdx, objId)` only consumes the id ([canvas.d.ts](../../node_modules/pdfjs-dist/types/src/display/canvas.d.ts) line 196). Ids that start with `g_` resolve on `page.commonObjs`; others on `page.objs` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) `CanvasGraphics.getObject`). `PDFObjects.get` without a callback throws if the decode is still pending ([pdf_objects.d.ts](../../node_modules/pdfjs-dist/types/src/display/pdf_objects.d.ts)); `getOperatorList` resolving does not mean every image is in `objs` yet.

---

## Placement is the CTM at paint time

ISO 32000-1:2008 §8.9.5.1: an image XObject is painted in the **unit square**. The current transformation matrix maps that square onto the page.

For CTM `[a, b, c, d, e, f]`:

| Vector | Components | Meaning                               |
| ------ | ---------- | ------------------------------------- |
| Width  | `(a, b)`   | Image +X in default page user space   |
| Height | `(c, d)`   | Image +Y in default page user space   |
| Origin | `(e, f)`   | Image (0, 0) — the unit-square origin |

Dictionary pixel width / height are **not** the on-page size.

`getOperatorList` starts from identity, the same way `getTextContent` does ([v2 note](./v2-pdf-text-capabilities.md)). Page `/Rotate` is **not** folded into the operators. Convert the user-space box with the existing `userBoxToDisplayed` / `userPointToDisplayed` path ([lib/editor/coordinates.ts](../../lib/editor/coordinates.ts)).

Compose `cm` with [`multiplyCtm`](../../lib/editor/coordinates.ts). There is no PDF.js helper that walks the list with a live CTM.

---

## What to keep vs skip

Keep:

- `paintImageXObject` and `paintInlineImageXObject`
- Axis-aligned placement (width · height ≈ 0)
- Quarter-turn CTMs (same perpendicular test; store displayed `rotation`)

Skip, and do not invent a box:

- Image masks and solid-color masks
- Skewed CTMs (columns not perpendicular)
- Paints after `clip` / `eoClip` until the matching `restore`
- `paintImageXObjectRepeat` unless the copies are simple axis-aligned repeats (out of scope for the first pass)

`page.objs` / `page.commonObjs` can resolve `{ width, height, data | bitmap, kind }` after the worker posts the image. Wait with `get(id, callback)` or `has(id)` before reading; then `cleanup()` clears `objs`. Pixel bytes stay out of `EditorDocument` so `structuredClone` history does not copy bitmaps. Resolve them lazily into an `ImageAsset` the first time a non-replaced image is moved, resized, or exported dirty.

---

## Session timing

[`PdfSession.open`](../../lib/pdf/session.ts) already calls `getTextContent()` and then `page.cleanup()` (lines 89–116). Image metadata must be read in that same pass, **before** `cleanup()`. `getPage` later can run `getOperatorList` again when pixel bytes are needed.

Use `annotationMode: AnnotationMode.DISABLE` so annotation appearance images are not treated as page photos.

---

## Proposed `PdfImageObject`

Keep original images off the user-object union. [`EditorObject`](../../lib/editor/types.ts) stays overlay-only. Add `EditorPage.pdfImageObjects`, parallel to `pdfTextObjects`.

| Field | Status | How |
| --- | --- | --- |
| `id`, `pageId`, `type: "pdf-image"` | Editor-owned | Assign locally |
| `sourceId` | Direct | PDF.js object id; shared when one XObject is painted twice |
| `sourceIndex` | Editor-owned | Paint index in the operator list |
| `x`, `y`, `width`, `height`, `rotation` | Derived | Displayed box from the paint CTM + crop / `/Rotate` |
| `originalX` / `Y` / `Width` / `Height` / `Rotation` | Editor-owned | Copy at extract time |
| `deleted` | Editor-owned | Soft delete so export still knows the original rectangle |
| `replacementAssetId` | Editor-owned | Points at `ImageAsset` (outside history) |
| `previewAssetId` | Editor-owned | Extracted original pixels, also an `ImageAsset` id |

Dirty means deleted, replaced, or geometry different from the originals.

---

## Coordinates

One canonical path, same as V2:

```text
PDF user space (crop + content CTM)
        ↕  userPointToDisplayed / displayedToUserSpace
displayed page space (top-left, includes /Rotate)
        ↕  screenToPage / pageToScreen
mouse / CSS pixels
```

Displayed `x,y,width,height` is the unrotated box; `rotation` is the CSS angle around the center, matching overlay objects and [`objectWrapperStyle`](../../lib/editor/coordinates.ts). Export already applies that via `displayedToUserSpace` + `centerRotateCtm` ([lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) `applyCtm`).

Do not add an image-specific coordinate system.

---

## Export: cover and redraw

pdf-lib 1.17.1 cannot move or delete an existing image XObject. `PDFPage.getContentStream` **appends** a new content stream ([v2 note](./v2-pdf-text-capabilities.md)). New drawing paints on top of the copied page.

Reuse the V2 white rectangle. The comment on [`drawDirtyPdfText`](../../lib/pdf/export-pdf.ts) already records that this fails on non-white and image backgrounds.

| Edit | Export |
| --- | --- |
| Unmodified | Draw nothing |
| Dirty or deleted | `drawRectangle` white over the **original** user-space box (with original rotation) |
| Moved / resized / replaced and not deleted | `embedPng` or `embedJpg`, then the existing `centerRotateCtm` placement at the **current** box |

Do not rasterize the page. Do not rewrite content streams. Source bytes stay the load input until `PDFDocument.load`, as the text export test already asserts.

PNG alpha: [`PngEmbedder.embedAlphaChannel`](../../node_modules/pdf-lib/es/core/embedders/PngEmbedder.js) writes the alpha channel as an `/SMask` (lines 29–62). JPEG has no alpha. WebP is already converted to PNG in [`readImageFile`](../../lib/pdf/image-file.ts).

---

## What to reuse

| Existing piece | Role |
| --- | --- |
| `EditorPage.pdfTextObjects` | Pattern for a parallel `pdfImageObjects` array |
| `displayedToUserSpace` / `userPointToDisplayed` | Extract + export |
| `screenToPage`, `objectWrapperStyle`, `resizeRotatedBox` | Hover, move, resize |
| `SelectionBox` | Selected chrome |
| `overlay-gestures` `finishGesture` → one `commit(..., true)` | One history entry per drag |
| `addAsset` / `ImageAsset` | Replacement and lazy preview bytes |
| `exportDocument` after dirty text, before overlay objects | Cover + redraw |

Unmodified images stay the PDF.js canvas ([lib/pdf/render-page.ts](../../lib/pdf/render-page.ts)).

---

## Known limits

- White covers fail on non-white and busy backgrounds (same as V2 text).
- Masks, clips, skew, and repeat paints are skipped.
- Soft masks / SMask on the **source** image may not round-trip into the preview `ImageAsset` if PDF.js decoded RGB only.
- The original `Do` operator remains in the page stream under the cover.
- Encrypted PDFs already fail open/export.

---

## Milestone stop line

Upload a normal PDF → click an existing image → move it → resize it → replace it → delete it → undo / redo → export → reopen and see the image changes.

---

## Sources

- Mozilla PDF.js API: [PDFPageProxy.getOperatorList](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)
- Installed types: `node_modules/pdfjs-dist/types/src/display/api.d.ts`, `types/src/shared/util.d.ts`, `types/src/display/canvas.d.ts`, `types/src/pdf.d.ts`
- ISO 32000-1:2008 §8.9.5.1 (image XObject unit square and CTM)
- pdf-lib 1.17.1: `es/core/embedders/PngEmbedder.js`
- Paperoo: [lib/editor/types.ts](../../lib/editor/types.ts), [lib/editor/coordinates.ts](../../lib/editor/coordinates.ts), [lib/pdf/session.ts](../../lib/pdf/session.ts), [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts), [docs/research/v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md)
