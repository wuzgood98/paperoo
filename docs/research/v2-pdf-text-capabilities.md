# V2 PDF text capabilities

What the first true-text-editing milestone can extract, select, and rewrite with the libraries already installed: click existing PDF text, change it, export it in the same place, without rewriting the overlay editor.

This note follows [v2-true-pdf-editing.md](../../v2-true-pdf-editing.md). It records extraction, coordinate mapping, fonts, and export limits. It does not implement the editor.

There was no research-notes convention in the repo (only `README.md`, `AGENTS.md`, and the spec). This file starts that convention under `docs/research/`.

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json), [pdfjs-dist/package.json](../../node_modules/pdfjs-dist/package.json))
- `pdf-lib@1.17.1` and `@pdf-lib/fontkit@1.1.1` ([package.json](../../package.json))

Primary sources are the installed package types and source, Mozilla’s PDF.js API docs, pdf-lib’s API source, and ISO 32000-1:2008 (PDF). Secondary write-ups are not used.

---

## Extraction API

`PDFPageProxy.getTextContent(params?)` returns a `Promise<TextContent>`. Mozilla documents that every whitespace character is replaced with U+0020 before the items are returned ([PDFPageProxy.getTextContent](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html), [api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1545–1553).

`TextContent` is ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 290–308, [Mozilla TextContent](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)):

| Field | Meaning |
| --- | --- |
| `items` | `TextItem \| TextMarkedContent` (marked-content entries only if `includeMarkedContent: true`) |
| `styles` | `TextStyle` map keyed by `fontName` |
| `lang` | Document `/Lang`, or `null` |

XFA-only documents skip the worker text builder. `getTextContent` then calls `XfaText.textContent`, which pushes `{ str }` with no geometry ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 16030–16032 and 921–947). Those pages cannot be selected by box.

`getTextContent` is the right extractor. Do not parse raw content-stream bytes for V2.

---

## Proposed `PdfTextObject` vs what PDF.js actually returns

The spec’s example type assumes `x`, `y`, `rotation`, `fontSize`, and `fontFamily` come from PDF.js. They do not.

### `TextItem` — direct fields

From [api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 312–342 and [Mozilla TextItem](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html):

| Field | Status | Notes |
| --- | --- | --- |
| `str` | Direct | Item string after whitespace normalization and bidi |
| `dir` | Direct | `'ttb'`, `'ltr'`, or `'rtl'` (from the worker’s bidi pass) |
| `transform` | Direct | 6-number text rendering matrix (typed `Array<any>`) |
| `width` | Direct | Run width; units below |
| `height` | Direct | Run height / em-size; units below |
| `fontName` | Direct | PDF.js **converted** font id (`loadedName`), not the PDF `/BaseFont` |
| `hasEOL` | Direct | True when this run is followed by a line break |

### `TextStyle` — looked up as `styles[item.fontName]`

From [api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 361–378:

| Field | Status | Notes |
| --- | --- | --- |
| `ascent` | Direct | Font ascent / 1000 ([worker Font constructor](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) line 27098) |
| `descent` | Direct | Font descent / 1000 (same, line 27099) |
| `vertical` | Direct | Vertical writing mode |
| `fontFamily` | Direct | CSS generic family: `sans-serif`, `serif`, or `monospace` ([worker fallbackName](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 27080–27087, assigned at 35891–35896) |

`fontExtraProperties` can add `fontSubstitution` / `fontSubstitutionLoadedName` on the style object ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35897–35900). Paperoo’s `getDocument` call in [lib/pdf/session.ts](../../lib/pdf/session.ts) does not set `fontExtraProperties`, so those extra keys are absent.

### Spec fields that must be derived or left optional

| Spec field | Status | How |
| --- | --- | --- |
| `x`, `y` | Derived | `transform[4]`, `transform[5]` are the **baseline origin** in page user space. Convert through the existing viewport / `displayedToUserSpace` inverse, then subtract ascent to get a top-left box. |
| `rotation` | Derived | `atan2` of the mapped X column. TextLayer uses `Math.atan2(tx[1], tx[0])` after its Y-flip ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 15223–15228). |
| `fontSize` | Derived | For horizontal text the worker sets `height = hypot(trm[2], trm[3])` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35905–35908). That is the em-size in user space. TextLayer uses the same formula after its layer matrix as CSS `fontSize` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 15231, 15246). |
| `fontFamily` (CSS name) | Partial | `TextStyle.fontFamily` is a generic (`sans-serif` / `serif` / `monospace`), not the embedded face. |
| `width`, `height` (editor box) | Derived | Item `width`/`height` plus ascent give the selectable rectangle. They are not already top-left displayed boxes. |
| `color` | Unavailable | Not on `TextItem` or `TextStyle`. |
| `id`, `pageId`, `sourceIndex`, `type` | Editor-owned | Assign locally. |

Do not invent color, exact face name, or paragraph bounds.

---

## Width / height units

The public typedef says width and height are “in device space” ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 326–331, [Mozilla TextItem](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)). That comment is easy to misread as CSS/canvas pixels. The worker does not know about the page viewport or zoom.

What the worker actually does:

1. `getCurrentTextTransform()` builds `Tsm = [fontSize * textHScale, 0, 0, fontSize, 0, textRise]`, then returns `CTM × (textMatrix × Tsm)` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35870–35879). That is the PDF text rendering matrix (ISO 32000-1:2008 §9.4.4).
2. `getTextContent` starts from `new TextState()` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) line 35795). The initial CTM is identity. Page `/Rotate` is **not** folded into the item transform.
3. Glyph advances accumulate in text space, then `flushTextContentItem` multiplies by `textAdvanceScale = |CTM_x| * |textLineMatrix_x|` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35914–35916, 36250–36258).
4. The flushed item uses `width: abs(totalWidth)` and `height: abs(totalHeight)` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35954–35961).
5. Glyphs whose origin falls outside `page.view` are dropped ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35974–35983; `viewBox` is `this.view` at [worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) line 59580).

ISO 32000-1:2008 §8.3.4 calls the space after the CTM “device space.” Here that means **default page user space** (the same units as `page.view`), after any content-stream `cm` operators, not browser device pixels and not the zoomed canvas.

`page.view` is the visible box in user-space `[x1, y1, x2, y2]`: the non-empty intersection of `/CropBox` and `/MediaBox`, else `/MediaBox` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 59265–59277, [PDFPageProxy.view](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)). [lib/pdf/session.ts](../../lib/pdf/session.ts) already stores that as `cropBox`.

**Store raw `transform`, `width`, and `height` as user-space values.** Convert into editor displayed space in one utility. Do not treat item `width`/`height` as CSS pixels.

---

## Deriving position, size, and rotation

ISO 32000-1:2008 §9.4.2 and §9.4.4: text is painted from a baseline origin; `Tfs` is the font size; `Tm` may add further scale and rotation. PDF.js bakes `Tfs`, horizontal scale, and text rise into `Tsm` before multiplying by `Tm` and the CTM ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35870–35879).

For a horizontal run:

- User-space origin: `(transform[4], transform[5])` — baseline, not top-left.
- User-space em-size: `height` (set from `hypot(trm[2], trm[3])`).
- User-space run width: `width`.
- Ascent in user space: `height * ascentRatio`. TextLayer measures `fontBoundingBoxAscent / (ascent + descent)` from a canvas, and only falls back to `style.ascent` if that metric is missing ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 15365–15391). For a headless extraction path, `style.ascent` (already divided by 1000) is the available number; default `0.8` matches TextLayer’s fallback (line 15377).

TextLayer maps the item through a **Y-flip only**:

```js
this.#transform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
```

([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 15090–15096.) Then:

```js
const tx = Util.transform(this.#transform, geom.transform);
left = tx[4];
top = tx[5] - fontAscent; // when angle === 0
```

([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 15223–15237.) That result is crop-relative top-left in **unrotated** page space. Page `/Rotate` is applied later by rotating the text-layer container (`setLayerDimensions`, line 15101), not by baking rotation into each item.

Paperoo does not use `TextLayer`. The canvas and overlay already live in **full viewport space**, including `/Rotate`, because [lib/pdf/session.ts](../../lib/pdf/session.ts) sizes the page with `page.getViewport({ scale: 1 })` and [lib/pdf/render-page.ts](../../lib/pdf/render-page.ts) paints with that viewport. Overlay objects are stored in that displayed space ([lib/editor/types.ts](../../lib/editor/types.ts) `BaseObject`).

Copying TextLayer’s Y-flip alone is wrong on `/Rotate` 90/180/270 pages. Use one of these, both of which already encode crop + rotation:

1. `page.getViewport({ scale: 1 }).convertToViewportPoint(x, y)` / `convertToPdfPoint` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 909–917). `getViewport` builds `PageViewport` from `this.view`, `userUnit`, scale, and `this.rotate` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 15814–15829).
2. A new inverse of `displayedToUserSpace` in [lib/editor/coordinates.ts](../../lib/editor/coordinates.ts) (lines 98–138). Export already uses the forward map ([lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) line 298).

Prefer extending [lib/editor/coordinates.ts](../../lib/editor/coordinates.ts) so hit-testing and export share one mapping. `screenToPage` / `pageToScreen` already convert displayed page space ↔ mouse space at the current zoom ([lib/editor/coordinates.ts](../../lib/editor/coordinates.ts) lines 52–68).

PDF user space is bottom-left; displayed editor space is top-left. `displayedToUserSpace` for `/Rotate` 0 is `userY = crop.y + crop.height - displayedY - height` ([lib/editor/coordinates.ts](../../lib/editor/coordinates.ts) lines 130–136). Tests lock that flip for top / crop-offset / 90 / 180 / 270 ([test/coordinates.test.ts](../../test/coordinates.test.ts), [test/export-coords.test.ts](../../test/export-coords.test.ts)). Replacement text must go through this path so export lands on the selected box.

---

## Items are glyph runs

The worker flushes a run when the font or size changes, when the advance looks like a new line, when a large vertical (or horizontal, for vertical text) shift appears, or when an EOL operator fires ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) `compareWithLastPosition` 35974–36106, `appendEOL` 36207–36223, `buildTextContentItem` 36108–36115).

It also inserts standalone `" "` items for tracking gaps (`pushWhitespace`, `addFakeSpaces`; [worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35853–35868, 36225–36248).

`hasEOL` and those inserted spaces are the only grouping signals. A sentence may arrive as `"Hello"`, `" "`, `"Gideon"` or as one item. Keep raw items. Do not reconstruct paragraphs in V2.

---

## Fonts

`item.fontName` is `textState.loadedName` — an internal converted-font id ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) line 35903). It is not a CSS family and not a pdf-lib `StandardFonts` key.

`TextStyle.fontFamily` is `font.fallbackName`: `monospace` if FixedPitch, `serif` if the name matches PDF.js’s serif table, otherwise `sans-serif` ([worker](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 27080–27087).

That maps onto the existing editor `FontFamily` of `"sans" | "serif" | "mono"` ([lib/editor/types.ts](../../lib/editor/types.ts) line 16). Export already embeds Liberation Sans for `"sans"` and pdf-lib standard fonts for serif/mono ([lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) lines 91–132; [lib/fonts/measure-text.ts](../../lib/fonts/measure-text.ts) `FONT_FILES`).

Keep resolution behind `resolvePdfFont(...)` as the spec asks. Store `fontName` and the generic family as metadata. Do not claim exact face matching.

pdf-lib can embed those fallbacks:

- `PDFDocument.embedFont(StandardFonts.*)` for Helvetica / Times / Courier ([PDFDocument.ts](../../node_modules/pdf-lib/src/api/PDFDocument.ts) lines 938–972; [StandardFonts.ts](../../node_modules/pdf-lib/src/api/StandardFonts.ts))
- `embedFont(bytes, { subset: true })` after `registerFontkit` for Liberation ([PDFDocument.ts](../../node_modules/pdf-lib/src/api/PDFDocument.ts) lines 236, 938–960)

Both paths are already used by [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts).

---

## Color and masking

`getTextContent` does not expose fill or stroke color. A white (or sampled) cover rectangle is the V2 mask. Non-white and image backgrounds will show a patch. Document that.

`getOperatorList` can see color operators, but that is a second pipeline and is out of scope for this milestone ([PDFPageProxy.getOperatorList](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)).

---

## Export: mask and redraw

pdf-lib 1.17.1 has no API to delete or rewrite an existing text-showing operator. `PDFPage` can append `drawText`, `drawRectangle`, images, and raw operators ([PDFPage.ts](../../node_modules/pdf-lib/src/api/PDFPage.ts) `drawText` 965–1015, `drawRectangle` 1348–1409). `getContentStream` registers a **new** stream and `PDFPageLeaf.addContentStream` **pushes** it onto `/Contents` ([PDFPage.ts](../../node_modules/pdf-lib/src/api/PDFPage.ts) lines 1565–1570; [PDFPageLeaf.ts](../../node_modules/pdf-lib/src/core/structures/PDFPageLeaf.ts) lines 119–123). New drawing paints **on top of** the copied page.

Current export already does that ([lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) `exportDocument` 343–390):

1. `PDFDocument.load(input.bytes)` — original bytes stay the source until this call.
2. `PDFDocument.create()` + `copyPages(source, sourceIndex list)`.
3. Draw each overlay object with `displayedToUserSpace`.

For a modified PDF text run, insert **before** the overlay loop:

1. `drawRectangle` over the user-space box (mask).
2. `drawText` with the replacement string, derived font size, and baseline `y` (`textBaselineY` already exists in [lib/editor/coordinates.ts](../../lib/editor/coordinates.ts) line 72; export text already uses `user.height - ascent` at [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) line 156).

Unmodified runs stay as the original page content. Do not rasterize the page.

`drawText` takes `x`, `y`, `size`, `font`, `color`, `rotate`, `maxWidth` ([PDFPageDrawTextOptions](../../node_modules/pdf-lib/src/api/PDFPageOptions.ts) lines 21–35). Coordinates are PDF user space (origin bottom-left), the same space `displayedToUserSpace` already produces.

---

## What to reuse in the current editor

```text
PDF user space (crop + content CTM)
        ↕  displayedToUserSpace / new inverse, or PageViewport scale=1
displayed page space (top-left, includes /Rotate)
        ↕  screenToPage / pageToScreen
mouse / CSS pixels
```

Do not add a second coordinate system.

| Existing piece | Role |
| --- | --- |
| `EditorPage.objects` + `source: "overlay"` ([lib/editor/types.ts](../../lib/editor/types.ts) lines 1, 36–38, 103–112) | Keep user-created objects here. Do not coerce extracted text into `TextObject` if that drops origin. |
| New `EditorPage.pdfTextObjects` (or equivalent) | Holds extracted runs. `HistorySnapshot.document` is the whole `EditorDocument` ([lib/editor/types.ts](../../lib/editor/types.ts) lines 129–133; [lib/editor/store.ts](../../lib/editor/store.ts) `getSnapshot` 110–114), so edits on that array participate in undo/redo **if** they go through `commit`. |
| `cropBox`, `sourceRotate`, `width`, `height` | Already taken from `page.view` and `getViewport({ scale: 1 })` ([lib/pdf/session.ts](../../lib/pdf/session.ts) lines 82–99). |
| `displayedToUserSpace` | Export and any mask rect. |
| `screenToPage` | Hit-test the interaction layer. |
| `selectedObjectIds` | Overlay-only today (`deleteSelected` / `patchSelected` walk `objects`). PDF-text selection needs its own id list or a tagged id space so Delete does not call `removeObjects` on a PDF run. |
| [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) | Append mask + replacement text, then existing overlay draws. |
| `pdfSession.getPage` | Call `page.getTextContent()` on the cached `PDFPageProxy`. |

Unmodified text stays the PDF.js canvas ([lib/pdf/render-page.ts](../../lib/pdf/render-page.ts)). The interaction layer is transparent hit regions in displayed space. Modified text: cover the original box in the overlay (and again at export) and draw the new string. Editor state is the desired document; `pdfSession.bytes` stay untouched until export ([lib/pdf/session.ts](../../lib/pdf/session.ts) line 43).

Hover, selection chrome, and the editing UI only need the displayed box plus `str` / `originalText`. Those are product decisions already in the spec.

---

## Performance

PDF.js itself caps DOM text-layer spans (`MAX_TEXT_DIVS_TO_RENDER` in [pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) line 15187). A page can still contain thousands of `TextItem`s. Do not mount one React component per item for the whole document. Keep geometry in a typed array / list, hit-test in the page overlay, and render hover/selection for the current hit and the current page.

---

## Known limits (from the libraries, not just the spec)

- Scanned / image-only pages: `getTextContent` returns no usable items.
- XFA-only pages: items may be `{ str }` with no boxes ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) 921–947).
- Color is unknown; masks on non-white backgrounds will be wrong.
- Exact embedded fonts are not identified; fallback is generic family + Liberation / standard 14.
- Adjacent items are not a paragraph. Editing one run will not reflow neighbors.
- pdf-lib cannot remove the original operators. The old glyphs remain under the mask and remain extractable by other tools.
- Encrypted PDFs already fail open/export ([lib/pdf/session.ts](../../lib/pdf/session.ts) `PasswordException`; [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts) `EncryptedPDFError`).

---

## Milestone stop line

The first milestone is still: upload a normal PDF, click existing text, change it, export a real PDF with the new text in the same place.

The data to do that is:

1. `page.getTextContent()` for `str`, matrix, width, height, `fontName`, `hasEOL`, and generic `fontFamily`.
2. One conversion through the existing crop/rotation helpers (or `getViewport({ scale: 1 })`) from baseline user space to displayed boxes.
3. Editor state that keeps PDF runs separate from overlay objects, with `originalText` vs `text` for dirty.
4. Export that copies original pages, covers dirty boxes, and `drawText`s the replacement, then draws V1 overlays.

Stop there. Images, paths, annotations, OCR, operator deletion, and reflow wait on these results.

---

## Sources

- Mozilla PDF.js API: [PDFPageProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html), [module pdfjsLib](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) (`TextItem`, `TextStyle`, `TextContent`)
- Installed types: `node_modules/pdfjs-dist/types/src/display/api.d.ts`
- Installed worker: `node_modules/pdfjs-dist/build/pdf.worker.mjs` (`getTextContent`, `getCurrentTextTransform`, Font `fallbackName`)
- Installed display build: `node_modules/pdfjs-dist/build/pdf.mjs` (`PageViewport`, `TextLayer`, `PDFPageProxy.getTextContent`)
- ISO 32000-1:2008 §8.3.4 (device space / CTM), §9.4.2 (text state), §9.4.4 (text rendering matrix)
- pdf-lib 1.17.1: `src/api/PDFPage.ts`, `src/api/PDFPageOptions.ts`, `src/api/PDFDocument.ts`, `src/core/structures/PDFPageLeaf.ts`, `src/api/StandardFonts.ts`
- Paperoo: [lib/editor/types.ts](../../lib/editor/types.ts), [lib/editor/coordinates.ts](../../lib/editor/coordinates.ts), [lib/editor/store.ts](../../lib/editor/store.ts), [lib/pdf/session.ts](../../lib/pdf/session.ts), [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts), [lib/pdf/render-page.ts](../../lib/pdf/render-page.ts)
