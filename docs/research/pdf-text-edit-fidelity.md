# PDF text edit fidelity — font, cover height, cover color

Why an edited PDF run ("Prompt" → "Prompts" on the Google _Prompt Engineering_ title slide) comes back in the wrong font, with a white box that is too tall and the wrong color. Each defect gets the current code path, what the installed APIs allow, feasible fixes with trade-offs, and a recommendation. This note does not change product code.

Related: [pdf-text-inline-edit-followups.md](./pdf-text-inline-edit-followups.md), [pdf-text-extract-colors.md](./pdf-text-extract-colors.md), [pdf-text-font-weight.md](./pdf-text-font-weight.md), [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md).

Installed versions (`node_modules/*/package.json`):

- `pdfjs-dist@6.3.289` (app loads `build/pdf.mjs` + `build/pdf.worker.mjs`, not `legacy/`: [`lib/pdf/pdfjs.ts`](../../lib/pdf/pdfjs.ts) 1–33)
- `pdf-lib@1.17.1` / `@pdf-lib/fontkit@1.1.1`

Line numbers for PDF.js refer to `node_modules/pdfjs-dist/build/pdf.mjs` (display) and `build/pdf.worker.mjs` (worker).

---

## Symptom (from the two screenshots)

|  | Before | After |
| --- | --- | --- |
| Face | Embedded geometric sans (likely Google Sans) | Liberation Sans Bold (generic grotesque) |
| Cover | — | White rect from ~0.15 em left of "P" down into the cap/ascender zone of "Engineering" |
| Page | Off-white (~`#f8f8f8`–`#fafafa`) | White box visible against it |

Also visible in the after shot: "Prompts" is a little bluer/darker than "Engineering". That matches the color fallback `#111827` that [`extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts) uses when it fails closed ([pdf-text-extract-colors.md](./pdf-text-extract-colors.md) "Locked algorithm" step 2). I have not confirmed it against this PDF. It is a separate issue and out of scope here.

---

## Shared model today

A clean PDF run is never redrawn: the ink stays on the PDF.js canvas. When the run is dirty, preview and export both **paint an opaque rect over the original run box, then draw the new string in a bundled font**. The original `Tj`/`TJ` operators stay in the content stream.

- Preview: [`PdfTextCoverPlate`](../../components/editor/pdf-text-layer.tsx) 74–92 (`bg-white`, 84), used by the editor (116, 148) and the dirty layer (256, 270).
- Export: [`drawDirtyPdfText`](../../lib/pdf/export-pdf.ts) 268–394. The cover is `rgb(1, 1, 1)` at 310–317, and the comment at 306–309 already admits it "fails on non-white and image backgrounds".

---

## 1. Font change

### Current code state

- Extract drops the font identity. `resolvePdfFont` maps the PDF.js `TextStyle.fontFamily` to `'sans' | 'serif' | 'mono'` ([`lib/pdf/extract-text.ts`](../../lib/pdf/extract-text.ts) 179–187). `TextStyle.fontFamily` is PDF.js's own **fallback** generic name, not the font: the worker sets `fontFamily: font.fallbackName` (worker 35891–35896), and `fallbackName` is only `"monospace" | "serif" | "sans-serif"` (worker 27077–27087).
- `PdfTextObject.fontName` _does_ hold the PDF.js `loadedName` (e.g. `g_d0_f1`; [`extract-text.ts`](../../lib/pdf/extract-text.ts) 299). PDF.js builds it as `${docId}_${fontID}` (worker 34985). Only `bold`/`italic`/`name` are read from the `commonObjs` FontFaceObject ([`extract-text.ts`](../../lib/pdf/extract-text.ts) 65–70, 82–93).
- Preview font: `fontFamilyCss(object.fontFamily)` → `"Liberation Sans", Arial, sans-serif` ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) 43; [`lib/fonts/measure-text.ts`](../../lib/fonts/measure-text.ts) 15–27). Width fitting uses the same family through `canvasTextWidth` (`measure-text.ts` 84–105; [`object-utils.ts`](../../lib/editor/object-utils.ts) 703–712).
- Export font: `fontKey` → `FONT_FILES.sans.*` Liberation TTFs, and `embedFontForStyle` embeds those bytes with `subset: true`. Serif and mono use the standard 14 fonts ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 131–211; `measure-text.ts` 3–10).

### What APIs support or block

**PDF.js: the converted font program is in the main thread, but only briefly.**

| Fact | Source |
| --- | --- |
| Every embedded Type1/CFF/TrueType/CIDFontType0/2 font is converted to an OpenType program with `mimetype = "font/opentype"` | Worker `Font` ctor 27125–27160 |
| `FontFaceObject` exposes `data`, `loadedName`, `mimetype`, `isType3Font`, `missingFile`, `systemFontInfo`, `ascent`, `descent`, `bbox`, `fontMatrix`, `name`, `bold`, `italic` | `pdf.mjs` 8156–8299; serialized fields `FONT_INFO` 8309–8318; worker `EXPORT_DATA_PROPERTIES` 26335 |
| On arrival, `FontLoader.bind` creates `new FontFace(loadedName, data)` and adds it to `document.fonts` | `pdf.mjs` 8022–8043, 8169–8186, 7940–7943 |
| **After binding, `data` is cleared unless `fontExtraProperties` is true** | `pdf.mjs` 16710–16714 (`clearData`, 8552–8563) |
| `fontExtraProperties` also exports `toUnicode`, `cMap`, `differences`, `defaultEncoding`, `widths`, `composite`, `subtype`, `type`, `toFontChar`, … as `extra` | Worker 26336, 27183–27189; option doc `api.d.ts` 704–708 ("increased memory usage") |
| `disableFontFace` (default `false` on the web) switches canvas text to path glyphs and skips FontFace creation | `api.d.ts` 699–703; `pdf.mjs` 15447, 8170, 8189 |
| Paperoo opens with neither option set | [`session.ts`](../../lib/pdf/session.ts) 238–245 |
| Registered faces live until document cleanup: `page.cleanup()` does not touch `commonObjs`, while `startCleanup` clears both `commonObjs` and the `fontLoader` | `pdf.mjs` 16994–17008; paperoo calls `page.cleanup()` at [`session.ts`](../../lib/pdf/session.ts) 443 and `doc.cleanup()` only in `close()` 535 |
| Canvas text uses `"${loadedName}", ${fallbackName}` as the `ctx.font` family; Type3 returns early (no face) | `pdf.mjs` 12064–12078 |
| Non-embedded fonts: `missingFile = true`, and with `useSystemFonts` (web default) `systemFontInfo.css` gives a `local()` substitute | Worker 27118–27124, 27190+; `api.d.ts` 665–669; `pdf.mjs` 7993–8020 |

**The converted font has a usable Unicode cmap for glyphs that are in it.** PDF.js moves every glyph to a Private Use Area code (`adjustMapping`, worker 26589–26648). It also records `toUnicodeExtraMap` (Unicode → glyph id, from the PDF `/ToUnicode` or the glyph-name fallback; 26618–26638) and writes both into the rebuilt `cmap` (`createCmapTable(..., toUnicodeExtraMap, ...)`: TrueType 28626–28633, CFF 28670–28675 and 28735). So CSS text like `"Prompt"` in `font-family: "g_d0_f1"` maps to the PDF's own glyphs, as long as each code point is in the subset and has a `/ToUnicode` entry. Limits: a glyph gets only one Unicode value (`!usedGlyphIds.has(glyphId)`, 26635), and PUA-range Unicode values are skipped.

**CSS falls back per character.** If the first family has no glyph for a character, the browser tries the next family in `font-family` for that character ([CSS Fonts 4 §5.4 font matching algorithm](https://www.w3.org/TR/css-fonts-4/#font-matching-algorithm)). `"g_d0_f1", "Liberation Sans", sans-serif` would draw "Prompt" in the embedded face and "s" in Liberation: no tofu, but mixed type. `FontFaceSet.check()` cannot detect this: it reports whether faces are loaded, not cmap coverage ([CSS Font Loading §4.3 `check()`](https://www.w3.org/TR/css-font-loading-3/#font-face-set-check); [MDN `FontFaceSet.check`](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check)).

**Embedding flags are erased.** For TrueType fonts that already have an OS/2 table, `validateOS2Table` **zeroes bytes 8–9** (`fsType`; 26869). Synthesized OS/2 tables write `fsType = 0` (26928–26933). The OS/2 `fsType` field is the embedding-permission field ([OpenType OS/2 `fsType`](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype)). The PDF.js bytes therefore cannot tell you the license. You have to read the original `/FontFile2` (TrueType) or the OpenType inside `/FontFile3` from the source PDF. Bare CFF / Type1 programs have no OS/2 table at all ([ISO 32000-1 §9.9 Embedded font programs](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)).

**pdf-lib + fontkit can embed the PDF.js bytes.** `PDFDocument.embedFont(Uint8Array, { subset })` calls `fontkit.create(bytes)` (`node_modules/pdf-lib/cjs/api/PDFDocument.js` 861–899). The embedder lays out text with `font.layout(text)` → glyph ids and writes a **new** Type0 / `Identity-H` font with `/ToUnicode` and `CIDFontType2` or `CIDFontType0` + `FontFile2`/`FontFile3` (`node_modules/pdf-lib/cjs/core/embedders/CustomFontEmbedder.js` 51–58, 92–182). The subset path re-subsets through fontkit `createSubset()` (`CustomFontSubsetEmbedder.js` 14–47, 54–64; fontkit `TTFSubset` 32731, `CFFSubset` 32865 with a CID-keyed branch at 33032, `createSubset` 33338 in `@pdf-lib/fontkit/dist/fontkit.es.js`). fontkit gives exact coverage checks: `hasGlyphForCodePoint(cp)` is a cmap lookup (`fontkit.d.ts` 587–593; `fontkit.es.js` 33182–33196). One unknown: fontkit has not been run against PDF.js-rebuilt fonts in this repo. Prove it with a fixture test before relying on it.

**Reusing the original font resource is possible, but only through low-level calls.** Export copies source pages with their `/Resources` ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 916–917), so the original font dict is already on the output page. pdf-lib can emit raw `Tf`/`Tj` against any resource name (the OCR path does this with `newFontDictionary` + `setFontAndSize` + `showText`, `export-pdf.ts` 852–894; `PDFPageLeaf.normalizedEntries().Font`, `node_modules/pdf-lib/cjs/core/structures/PDFPageLeaf.d.ts` 34–52). What's missing:

- **Resource name ↔ `loadedName` link.** PDF.js caches fonts by `Ref` and emits `setFont [loadedName, size]` (worker 34905–34985, 35336). The resource key (`/F1`) and the Ref are never exported. Matching is possible by `FontFaceObject.name` (the `/BaseFont`, including any `ABCDEF+` subset tag) against the pdf-lib font dicts in the page and Form XObject resources. Subset tags make collisions unlikely, but not impossible.
- **Encoding text for that font.** The string must be in the font's encoding, not Unicode ([ISO 32000-1 §9.4.3 text-showing operators](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf); simple-font encodings §9.6.6; Type0/CMaps §9.7, `Identity-H` §9.7.5.2). You have to invert `/ToUnicode` (§9.10.3) to get Unicode → char code. With `fontExtraProperties` that map arrives as `extra.toUnicode`, a structured-clone of the worker's `ToUnicodeMap` (`_map` array) or `IdentityToUnicodeMap` (`firstChar`/`lastChar`) (worker 20865–20905). These are private shapes that can change between PDF.js versions. The alternative is to parse `/ToUnicode` yourself from the pdf-lib object (decodable with `decodePDFRawStream`, `node_modules/pdf-lib/cjs/core/streams/decode.js` 16–58).
- **Width and glyph presence.** A code with no glyph in the subset renders `.notdef` or nothing. Viewers advance by `/Widths` or `/W` (§9.2.4, §9.7.4.3), which is right for glyphs that exist.

**Type3** (`isType3Font`): no FontFace is created (`pdf.mjs` 12064–12066), so a CSS preview is impossible. Glyphs are content-stream procedures (§9.6.5). Raw `Tj` reuse can still work for codes that have a `/CharProcs` entry.

**Subset fonts** carry only the glyphs the document used, and their names have a six-letter `ABCDEF+` tag (ISO 32000-1 §9.6.4). On a cover slide the display weight may only contain `P r o m p t E n g i e`, so the "s" in "Prompts" can really be missing.

### Feasibility and risks

| Option | Preview | Export | Main risks |
| --- | --- | --- | --- |
| **A. CSS `loadedName` + bundled fallback** | `font-family: "<loadedName>", "Liberation Sans", …` — already registered, no extra bytes | — (preview only) | Mixed glyphs when coverage is partial; CSS layout uses the font's `hmtx` advances, while PDF.js positions by PDF `/Widths` (usually equal for real subsets); FontFace is gone after `doc.cleanup()` |
| **B. Embed PDF.js bytes via pdf-lib** | Same as A | `embedFont(fontData, { subset: true })` | Needs `fontExtraProperties: true` (memory: every font program stays on the main thread); fontkit vs rebuilt fonts untested; adds a second copy of the face; `fsType` must come from the source font file |
| **C. Reuse original font resource (raw `Tf`/`Tj`)** | Same as A | Original `/F1`, encoded char codes | Resource matching heuristic; private `toUnicode` shape or own CMap parse; Identity-H 2-byte codes; Form XObject scope; best fidelity with no font duplication |
| **D. Status quo / user-picked font** | Liberation / Times / mono | Same | Always visibly wrong on branded decks |

Licensing: B creates a new embedded copy derived from the document's subset. C only references the existing embedded program. When `fsType` has the Restricted bit (0x0002) or the Bitmap-only bit (0x0200), the only conservative choice is the bundled fallback or C. C changes no font data, but this is a policy call, not a technical one.

### Recommended approach — detect coverage, then fall back

1. **Keep the identity on extract.** Store `pdfFontLoadedName` (already `fontName`), `pdfFontName` (`face.name`), `isType3Font`, and `missingFile` on `PdfTextObject` beside the existing generic `fontFamily`.
2. **Coverage set per font, cheap tier (no new PDF.js options):** the union of code points in every `getTextContent` `str` with that `fontName` across all hydrated pages. Every glyph seen there is in the subset. This under-approximates (it misses glyphs the subset has but the document never shows), and it misses glyphs whose `/ToUnicode` is wrong or missing.
3. **Exact tier (needs `fontExtraProperties: true`):** keep `FontFaceObject.data` and run `fontkit.create(data).hasGlyphForCodePoint` on the replacement string. This also unlocks B for export.
4. **Policy per run:** covered by the PDF font → `font-family: "<loadedName>"` in preview, and B or C in export. Not covered, Type3, or `missingFile` without `systemFontInfo` → the whole run uses the bundled family (today's path). Do not mix fonts inside one run. Surface a "font substituted: glyph 's' not in embedded subset" hint in the inspector.
5. **Export order of preference:** C when the resource match and the encoding both succeed for every char. Otherwise B when `fsType` permits. Otherwise the bundled Liberation family.

---

## 2. Cover too tall

### Current code state

- Run box from PDF.js: `em = |item.height|` (`hypot(trm[2], trm[3])`, i.e. font size × CTM, worker 35907). Above the baseline the box spans `em × style.ascent`. Below it spans `em × max(1 − ascent, |descent|, 0.25)` ([`coordinates.ts`](../../lib/editor/coordinates.ts) 163–171, 282–321; user box 300–305). `style.ascent`/`descent` are the font's `/FontDescriptor` `Ascent`/`Descent` divided by 1000 (worker 27098–27099, 35893–35894), which are **font-wide** metrics (ISO 32000-1 §9.8 font descriptors), not this string's ink.
- The **0.25 em descent floor** (`DEFAULT_DESCENT_FLOOR`) plus `1 − ascent` make the box at least `ascent + 0.25` em tall, even when the string has no descenders.
- Cover = fitted run box, widened by `0.15 em` on the left (`PDF_TEXT_COVER_LEFT_EM`), extended to the replacement width, and stretched to a caption underline if one exists ([`object-utils.ts`](../../lib/editor/object-utils.ts) 676–687, 737–763). The box is the same in preview and export ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) 116/256; [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 289–317).
- Nothing checks other runs on the page.

For display type set solid (leading ≈ 1.0–1.1 em), line 1's below-baseline band (≥ 0.25 em) reaches ~0.75 em above line 2's baseline. That is where the tittle of `i` and the tops of `E`/`g` sit, so the cover hides them.

### What APIs support or block

| Source | Tight bound? |
| --- | --- |
| `TextStyle.ascent/descent` (`api.d.ts` 361–378) | Font-wide only; the current input |
| `FontFaceObject.bbox` / `fontMatrix` (`pdf.mjs` 8266–8271) | `/FontBBox`, the union of all glyphs. Looser, not tighter |
| fontkit `glyph.bbox` on `FontFaceObject.data` | Per-glyph ink, exact. Needs `fontExtraProperties` (§1) |
| Canvas `TextMetrics.actualBoundingBoxAscent/Descent` | Per-string ink of the **CSS-rendered** font ([MDN TextMetrics](https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics/actualBoundingBoxAscent)). Exact when the preview uses the `loadedName` face (§1 A); wrong for Liberation |
| Rendered page pixels (`getImageData`) | True ink. It includes neighbours' ink inside the box (the very `i` dot), so it needs separation |

### Feasibility and risks

1. **Glyph-ink vertical bound (low risk).** Compute `[baseline − inkAscent, baseline + inkDescent]` for the **original** string, plus ~1 device px of bleed (the image cover already bleeds by 1 pt: `PDF_IMAGE_COVER_BLEED`, [`object-utils.ts`](../../lib/editor/object-utils.ts) 503–516). Source order: fontkit glyph bboxes → `measureText` actual box with the `loadedName` face → today's metrics **without** the 0.25 floor. "Prompt" has descenders (`p`), so its bottom stays near `|descent|`, but the cover drops the floor and the cap-to-ascender slack.
2. **Pixel ink scan (medium risk).** Inside the run's columns, find rows that hold non-background pixels close to the run's fill color. The red `i` tittle would be excluded by color. Same-colored neighbours would not, so this works only as a refinement of (1).
3. **Neighbour clipping (medium).** For every other `PdfTextObject` on the page, compute its tight ink box (1). Where it overlaps this cover horizontally, trim the facing edge down to the neighbour's ink edge, but never past this run's own ink. If the two inks really interleave (a descender hanging between ascenders), split the cover into per-glyph rects. Per-glyph x positions come from `extra.widths` × size + `Tc`/`Tw`, or from fontkit advances; `getTextContent` only gives run width.
4. **Width.** Once the cover color matches the page (§3), the cover only has to hide **old** ink. It no longer needs to stretch to the replacement width, which today can spill over runs to the right.

### Recommended approach

Write a pure `pdfTextInkBox(object, metrics)` helper that both preview and export use. Shrink to the ink bound (1). Clip against same-page runs (3). Size the cover to the original ink width + bleed, not to the fitted width. Keep the underline extension. Tests: two stacked runs at 1.0 em leading must give non-overlapping covers; "Prompt" must keep its `p` descenders covered.

---

## 3. Cover color

### Current code state

- Hardcoded white: preview `bg-white` ([`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) 84); export `rgb(1, 1, 1)` ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 310–317).
- **Pixel sampling already exists.** For link-caption edits, `sampleLinkCaptionFromPage` renders the page off-screen through `getPageContentCanvas` (`AnnotationMode.DISABLE`, cached per page/scale/rotation) and reads `getImageData` over the run box. The result goes into `captionFill`/`captionUnderline` on `PdfTextObject` ([`lib/pdf/sample-link-caption-from-page.ts`](../../lib/pdf/sample-link-caption-from-page.ts) 16–46; [`lib/pdf/pdf-annotation-content-cache.ts`](../../lib/pdf/pdf-annotation-content-cache.ts) 13–38; [`lib/pdf/sample-caption-ink.ts`](../../lib/pdf/sample-caption-ink.ts) 245–258; store [`store.ts`](../../lib/editor/store.ts) 474–484; types [`types.ts`](../../lib/editor/types.ts) 122–124). The sampler treats every pixel ≥ 240/channel as "paper" and **skips** it (`NEAR_WHITE`, `isPaper`, `sample-caption-ink.ts` 7, 41–42), so it can't report a background color as written.
- The visible page canvas is private to [`PdfCanvas`](../../components/editor/pdf-canvas.tsx) 19, 66 (no ref exported). It is a regular `<canvas>` painted by `renderPdfPage` ([`lib/pdf/render-page.ts`](../../lib/pdf/render-page.ts) 88–140), at device-pixel scale (`sizeCanvas` 40–62), and is released on unmount (64–67).

### What APIs support or block

- `getImageData` throws `SecurityError` only when the canvas is not origin-clean ([HTML §4.12.5 origin-clean flag](https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-origin-clean); [MDN `getImageData`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData)). PDF.js paints from bytes passed to `getDocument({ data })` ([`session.ts`](../../lib/pdf/session.ts) 238–245), and the caption sampler already reads pixels this way in production. So pixels are readable at edit time with no blocker.
- Pixel values are sRGB (the default canvas color space). Export writes DeviceRGB through `rgb()`. That is an exact round trip for DeviceRGB/DeviceGray pages, and an approximation for ICC-based or CMYK backgrounds (PDF.js already converted those for display).
- **pdf-lib cannot remove operators.** `pushOperators` only appends to a new content stream added after the existing ones (`node_modules/pdf-lib/cjs/api/PDFPage.js` 786–794, 1359–1367). `PDFContentStream` is write-only. pdf-lib has object/xref parsers but no content-stream operator parser (`node_modules/pdf-lib/cjs/core/parser/`), only filter decoding (`decode.js` 16–40: Flate, LZW, ASCII85, ASCIIHex, RunLength).

### Feasibility and risks

| Option | Fidelity | Cost / risk |
| --- | --- | --- |
| **Sample background, flat cover in that color** | Correct on flat tints such as this slide | Low. Wrong on gradients, photos, and patterns |
| **Uniformity gate + white fallback** | Avoids a confidently wrong flat color | Low. Still a box on textured pages |
| **Knock out only glyph pixels** (inpaint the ink mask with the local background, export as a small raster patch or per-glyph rects) | Handles tight leading. Can handle mild gradients | Medium–high. Resolution-dependent raster in export; anti-aliasing fringes |
| **Remove the original `Tj`/`TJ` (content-stream rewrite)** | True fix: no cover, any background | High (below) |

**What a content-stream rewrite needs:**

1. Decode each stream in `/Contents` (pdf-lib `decodePDFRawStream`).
2. Write a tokenizer for the content-stream syntax (ISO 32000-1 §7.8.2, operator summary Annex A).
3. Track graphics and text state (`q`/`Q`, `cm`, `BT`/`ET`, `Tf`, `Tm`/`Td`/`TD`/`T*`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`; §8.4, §9.3, §9.4).
4. Link each show operator to the `getTextContent` item. This is the same alignment problem as [pdf-text-extract-colors.md](./pdf-text-extract-colors.md), where adjacent `Tj`s merge into one item.
5. Delete or split the string, keeping later glyph positions with a `TJ` number adjustment or `Td`.
6. Recurse into Form XObjects, with copy-on-write when a form is shared across pages.
7. Re-encode and replace `/Contents` through the low-level `PDFDict.set` API.

Weeks of work. Silent corruption is the failure mode.

### Recommended approach

1. On edit start (the same moment `sampleLinkCaptionFromPage` runs), read the content canvas over the cover box **plus a 2–4 device-px ring**. Drop pixels inside any page text-run ink box. Bucket the colors (as `bucketKey` does) and take the **mode**.
2. Accept it when the mode holds ≥ ~70% of the ring and the ring's spread is small. Otherwise set `coverUniform: false`, keep white, and show a hint.
3. Store `coverColor` (hex) on `PdfTextObject`. Preview uses it as the plate's `backgroundColor`. Export uses `color(object.coverColor)`. Persisting the color is what keeps preview and export in sync. Don't re-sample at export time: there is no DOM in the worker or test path, and zoom-dependent rendering could give a different value.
4. Factor a `sampleBackground` beside `sampleCaptionInk`. Do not reuse `isPaper`, which throws away exactly the near-white pixels we need.

Limitation: gradients, images, and patterned backgrounds still show a flat patch. Only knock-out or content-stream removal fixes those.

---

## 4. Same white-cover pattern elsewhere

| Site | What it covers | Path |
| --- | --- | --- |
| Dirty PDF text | Original run | [`pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) 84; [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 310–317 |
| Dirty/deleted PDF image | Original image box + 1 pt bleed | [`pdf-image-layer.tsx`](../../components/editor/pdf-image-layer.tsx) 93; [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 442–448; box [`object-utils.ts`](../../lib/editor/object-utils.ts) 503–516 |
| Dirty/deleted PDF vector | The original **path** re-stroked/filled in `#ffffff` (shape-accurate, not a rect) | [`object-utils.ts`](../../lib/editor/object-utils.ts) 595–609; [`pdf-vector-layer.tsx`](../../components/editor/pdf-vector-layer.tsx) 262; [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 613–655 |
| OCR word replacement | Text object box | [`object-view.tsx`](../../components/editor/objects/object-view.tsx) 24–26; [`export-pdf.ts`](../../lib/pdf/export-pdf.ts) 238–247 |

The `drawRectangle` calls at ~727 and ~769 are **not** covers: they are user highlight (`drawHighlight` 721–737, Multiply blend) and user shape (`drawShape` 739–782) objects. Leave them alone. The form-widget `bg-white` classes in [`pdf-form-layer.tsx`](../../components/editor/pdf-form-layer.tsx) 67/142/203/233/264 are widget chrome, not covers.

**Share the fix:** one `coverColor` sampler and storage pattern for text, image, vector, and OCR covers, with white as the fallback. Images and vectors gain less: a moved image usually leaves a hole over a varied background. The vector cover's path-shaped knockout is already the "ink only" approach from §3, just in white.

---

## Prioritized recommendation

1. **Cover color** (small, low risk, fixes the most visible artifact on tinted decks): `sampleBackground` + `coverColor` on `PdfTextObject`, then the same pattern for image/vector/OCR covers.
2. **Cover geometry** (small–medium): drop the 0.25 em floor in favour of the glyph-ink bound, clip against neighbouring runs, and size the cover to the original ink width.
3. **Preview font via `loadedName`** with whole-run fallback, using the cheap seen-glyphs coverage set. No new PDF.js options needed.
4. **Export font**: turn on `fontExtraProperties`, measure the memory cost on large decks, add exact fontkit coverage, then do C (reuse the original resource) where the resource match and encoding succeed and B (embed the PDF.js bytes) where `fsType` permits. Fixture tests: subset TrueType, CFF/Type1C, Identity-H CID, Type3, non-embedded.
5. **Content-stream removal**: a long-term, separate project. Only start it once the alignment layer from the color work is proven.

---

## Touch points

| Area | Path |
| --- | --- |
| Font identity on extract | [`lib/pdf/extract-text.ts`](../../lib/pdf/extract-text.ts), [`lib/editor/types.ts`](../../lib/editor/types.ts) |
| PDF.js options / font data retention | [`lib/pdf/session.ts`](../../lib/pdf/session.ts) 238–245, 397–402 |
| Preview font + cover plate | [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx), [`lib/fonts/measure-text.ts`](../../lib/fonts/measure-text.ts) |
| Ink box / cover box | [`lib/editor/coordinates.ts`](../../lib/editor/coordinates.ts) 163–171, 282–321; [`lib/editor/object-utils.ts`](../../lib/editor/object-utils.ts) 676–763 |
| Background sampling | [`lib/pdf/sample-caption-ink.ts`](../../lib/pdf/sample-caption-ink.ts), [`lib/pdf/pdf-annotation-content-cache.ts`](../../lib/pdf/pdf-annotation-content-cache.ts), caller next to [`sample-link-caption-from-page.ts`](../../lib/pdf/sample-link-caption-from-page.ts) |
| Export font / cover | [`lib/pdf/export-pdf.ts`](../../lib/pdf/export-pdf.ts) 131–211, 268–394, 428–449, 613–655 |
| Other covers | [`pdf-image-layer.tsx`](../../components/editor/pdf-image-layer.tsx), [`pdf-vector-layer.tsx`](../../components/editor/pdf-vector-layer.tsx), [`objects/object-view.tsx`](../../components/editor/objects/object-view.tsx) |

---

## Sources

- Repo: files and line ranges cited inline above.
- PDF.js display (`build/pdf.mjs`): `FontLoader` 7927–8155; `FontFaceObject` 8156–8299; `FONT_INFO` 8309–8318; `FontInfo.data/clearData` 8545–8563; canvas `setFont` 12052–12078; `getDocument` option defaults 15447–15463; `commonobj` Font handler 16690–16715; `startCleanup` 16994–17008. Types: `api.d.ts` 312–378 (`TextItem`/`TextStyle`), 665–708 (`useSystemFonts`, `disableFontFace`, `fontExtraProperties`).
- PDF.js worker (`build/pdf.worker.mjs`): `ToUnicodeMap` 20865–20905; export property lists 26335–26336; `adjustMapping` 26589–26648; `createCmapTable` 26697; `validateOS2Table` 26847–26871; `createOS2Table` 26872–26933; `Font` ctor 27042–27168; `exportData` 27183–27189; `fallbackToSystemFont` 27190+; TrueType cmap rebuild 28626–28640; CFF `convert` 28660–28735; `charToGlyph` 28857–28858; `loadFont` 34905–35005; `setFont` op 35336; text style / item height 35891–35907; `TranslatedFont.send` 37510–37518.
- pdf-lib 1.17.1: `cjs/api/PDFDocument.js` 861–899; `cjs/core/embedders/CustomFontEmbedder.js` 51–182; `CustomFontSubsetEmbedder.js` 14–64; `cjs/api/PDFPage.js` 786–794, 1359–1367; `cjs/core/structures/PDFPageLeaf.d.ts` 30–52; `cjs/core/streams/decode.js` 16–58.
- @pdf-lib/fontkit 1.1.1: `fontkit.d.ts` 561–601; `dist/fontkit.es.js` 18649 (`fsType`), 32731 / 32865 / 33032 / 33338 (subsetting), 33182–33196 (cmap lookup).
- [ISO 32000-1:2008 (PDF 1.7)](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf): §7.8.2 content streams; §8.4 graphics state; §9.2.4 glyph metrics; §9.3–9.4 text state / text objects / showing operators; §9.6.4 font subsets; §9.6.5 Type3; §9.6.6 encodings; §9.7 Type0/CIDFonts/CMaps (§9.7.5.2 `Identity-H`); §9.8 font descriptors; §9.9 embedded font programs; §9.10.3 ToUnicode CMaps; Annex A operator summary.
- [OpenType OS/2 — `fsType`](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype).
- [CSS Fonts 4 §5 font matching](https://www.w3.org/TR/css-fonts-4/#font-matching-algorithm); [CSS Font Loading 3 `check()`](https://www.w3.org/TR/css-font-loading-3/#font-face-set-check); [MDN `FontFaceSet.check`](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check).
- [HTML canvas origin-clean](https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-origin-clean); [MDN `getImageData`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData); [MDN `TextMetrics.actualBoundingBoxAscent`](https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics/actualBoundingBoxAscent).
