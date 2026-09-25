# pdf-lib 1.17.1 export research

Primary-source investigation for Paperoo's export pipeline. The original PDF is loaded with pdf-lib; overlay objects stored in **top-left-origin PDF page space** (points, y down) are drawn so the exported file matches the editor.

**Research date:** 2026-09-25. **Verified against:** `pdf-lib@1.17.1` and `@pdf-lib/fontkit@1.1.1` installed in `%TEMP%\Paperoo-pdflib` (outside the repo). pdf-lib ships original TypeScript under `src/`; every claim cites a path + symbol there.

The [pdf-lib export research](d54bb506-2933-4311-9db6-14626cb2b69f) agent gathered these readings before dying on a usage limit; this file completes the write from those sources plus follow-up reads of the same scratch install.

---

## 1. Coordinates and rotation origin

**Direct answer.** pdf-lib user space is bottom-left, y up. Every `draw*` call that accepts `rotate` does `translate(x, y)` then `rotate` — so `(x, y)` is the **pivot**, and it is the **bottom-left** of the unrotated box for images and rectangles, and the **left baseline** for text. That is not CSS's default `transform-origin: center`.

### Conversion from editor space (top-left, y down)

Let `H` be the visible page height in points (CropBox height after accounting for `/Rotate` — see §2).

```
pdfX = crop.x + editorX
pdfY_box = crop.y + H - editorY - height     // images, rects, highlights
pdfY_text = crop.y + H - editorY - ascent    // text: CSS top → PDF baseline
```

### What `rotate` actually does (from the operator emitters)

**Text** — `rotateAndSkewTextRadiansAndTranslate(θ, xSkew, ySkew, x, y)` then `showText`. `(x, y)` is the text matrix origin = left baseline. Source: `pdf-lib/src/api/operations.ts` `drawText` (lines 52–72).

**Image** — `translate(x, y)` → `rotateRadians(θ)` → `scale(width, height)` → `Do`. `(x, y)` is the unrotated bottom-left. Source: `operations.ts` `drawImage` (lines 106–128).

**Rectangle** — `translate(x, y)` → `rotateRadians(θ)` → `moveTo(0,0)` → `lineTo(0,h)` → `lineTo(w,h)` → `lineTo(w,0)`. Same bottom-left pivot. Source: `operations.ts` `drawRectangle` (lines 202–209).

**Ellipse** — `(x, y)` is the **center**. The no-`rotate` branch (`drawEllipsePath`) emits illegal `q`/`Q` mid-path (back-compat, PR 511). Always pass `rotate: degrees(0)` to take `drawEllipseCurves`. Source: `operations.ts` lines 311–326.

### Center-rotation (what the editor must use)

Canva-like handles rotate around the box center. pdf-lib cannot express that via the `rotate` option alone. Export must emit an explicit CTM:

```
q
1 0 0 1 cx cy cm          % center in PDF space
c s -s c 0 0 cm           % rotate θ
1 0 0 1 -w/2 -h/2 cm      % local bottom-left
…draw unrotated…
Q
```

Do this with `page.pushOperators(...)`. Do not pass `rotate` on the high-level draw call when using this matrix.

---

## 2. Existing `/Rotate` and boxes

**Direct answer.** `getSize()` / `getWidth()` / `getHeight()` read **MediaBox only** and ignore `/Rotate`. Draw APIs never consult `/Rotate` or CropBox. PDF.js `getViewport()` **does** apply `page.rotate` and uses `page.view` (typically CropBox). That mismatch is the main export-fidelity trap.

### APIs

```ts
// pdf-lib/src/api/PDFPage.ts
setRotation(angle: Rotation): void  // asserts multiple of 90, writes /Rotate
getRotation(): Rotation             // degrees(node.Rotate() ?? 0)
getSize(): { width, height }        // from getMediaBox(), ignores Rotate
getMediaBox(): { x, y, width, height }
getCropBox(): { x, y, width, height }  // falls back to MediaBox
```

`setRotation` source: `PDFPage.ts:136–140`. `getSize` source: `PDFPage.ts:397–399`. `getCropBox` source: `PDFPage.ts:468–470`.

### Algorithm the exporter must run per page

1. Read `crop = page.getCropBox()`, `media = page.getMediaBox()`, `rot = page.getRotation().angle` (normalize to `{0,90,180,270}`).
2. Treat editor coordinates as **displayed page space**: origin at the top-left of what PDF.js showed, size = the viewport CSS size / zoom, in points. PDF.js already applied `/Rotate` and CropBox.
3. Map displayed `(x, y, w, h)` into **unrotated user space** (content-stream space, MediaBox origin):

| `/Rotate` | displayed → user-space origin of a top-left box |
| --- | --- |
| 0 | `(crop.x + x, crop.y + crop.height - y - h)` |
| 90 | `(crop.x + y, crop.y + x)` — then swap w/h for axis-aligned draws |
| 180 | `(crop.x + crop.width - x - w, crop.y + y)` |
| 270 | `(crop.x + crop.width - y - h, crop.y + crop.height - x - w)` |

4. Then apply the center-rotation CTM of §1 in user space.

Unit-test this matrix against a fixture PDF with `/Rotate 90` and a non-zero CropBox origin. Do not use `page.getSize()` as the editor page size — store `width`/`height` from PDF.js `viewport.width / scale` at load time (those already include rotation).

---

## 3. Draw APIs, opacity, blend mode

All high-level draw methods accept `opacity`, `borderOpacity` (where stroked), and `blendMode`. `BlendMode.Multiply` exists and is what highlights should use.

```ts
// pdf-lib/src/api/PDFPageOptions.ts
export enum BlendMode {
  Normal = "Normal",
  Multiply = "Multiply",
  Screen = "Screen",
  Overlay = "Overlay",
  Darken = "Darken",
  Lighten = "Lighten",
  ColorDodge = "ColorDodge",
  ColorBurn = "ColorBurn",
  HardLight = "HardLight",
  SoftLight = "SoftLight",
  Difference = "Difference",
  Exclusion = "Exclusion",
}
```

ExtGState emission (`PDFPage.ts` `maybeEmbedGraphicsState`, lines 1579–1604):

```ts
{ Type: 'ExtGState', ca: opacity, CA: borderOpacity, BM: blendMode }
```

`ca` = non-stroking alpha, `CA` = stroking alpha, `BM` = blend mode. Highlights: `blendMode: BlendMode.Multiply`, `opacity: 0.4`, no border.

`drawSvgPath` options (`PDFPageDrawSVGOptions`): `x, y, scale, rotate, borderWidth, color, opacity, borderColor, borderOpacity, borderDashArray, borderDashPhase, borderLineCap, blendMode`. **No `borderLineJoin`.** `LineJoinStyle` exists in `operators.ts` (`Miter=0, Round=1, Bevel=2`) but is not wired through. Freehand strokes need `page.pushOperators(setLineJoin(LineJoinStyle.Round))` inside the same `q`/`Q`, or a custom path emitter.

---

## 4. `drawSvgPath` Y-axis

**Confirmed in source.** After `translate(x,y)` and `rotate`, it always does:

```ts
// operations.ts:360–361
options.scale ? scale(options.scale, -options.scale) : scale(1, -1);
```

Comment on the previous line: _"SVG path Y axis is opposite pdf-lib's."_ Path data is interpreted as SVG (y down) relative to the translated origin. `x`/`y` are the PDF-space point that corresponds to SVG `(0,0)`.

### Recipe for a top-left-origin points array

Store stroke points in editor space. On export:

1. Convert each point to displayed space, then to user space **without** applying the SVG Y-flip yourselves.
2. Build an SVG path in **editor / displayed** coordinates (y down), with the first point as `(0,0)` relative to a chosen origin `P`.
3. Call `drawSvgPath(path, { x: P.pdfX, y: P.pdfY, borderColor, borderWidth, borderOpacity, borderLineCap: LineCapStyle.Round, opacity })` where `P.pdfY` is the PDF Y of that same first point (bottom-left conversion, **not** minus height — a stroke has no box height).
4. Inject `setLineJoin(LineJoinStyle.Round)` via `pushOperators`.

Alternatively skip `drawSvgPath` and emit `m`/`l`/`S` in PDF user space (y up) with `pushOperators`. That avoids the implicit `scale(1,-1)` and is easier to unit-test. **Prefer `pushOperators` for drawings.**

---

## 5. Fonts and text fidelity

### Standard fonts (WinAnsi only)

`StandardFonts` (`pdf-lib/src/api/StandardFonts.ts`): Courier (+Bold/Oblique/BoldOblique), Helvetica (same), Times-Roman (same), Symbol, ZapfDingbats.

Custom (non-WinAnsi) code points throw from `@pdf-lib/standard-fonts` when encoding. Do not use standard fonts for user text — Helvetica ≠ any CSS font, so metrics will never match the editor.

### Custom TTF via fontkit

```ts
// PDFDocument.ts:938 embedFont
doc.registerFontkit(fontkit);
const font = await doc.embedFont(ttfBytes, { subset: true });
font.widthOfTextAtSize(text, size): number;
font.heightAtSize(size, { descender?: boolean }): number;  // default descender: true
font.sizeAtHeight(height): number;
```

`EmbedFontOptions` (`PDFDocumentOptions.ts:36–40`): `subset?, customName?, features?`.

`CustomFontEmbedder` (`CustomFontEmbedder.ts:49, 74–98`):

- `this.scale = 1000 / this.font.unitsPerEm`
- width = sum of glyph `advanceWidth * scale * (size/1000)` (kerning included via `font.layout`)
- height = `((ascent - descent) * scale / 1000) * size` (`ascent`/`descent` from fontkit, fallback to bbox)

Missing `registerFontkit` throws `FontkitNotRegisteredError` (`api/errors.ts:13–18`).

### Baseline problem

CSS positions a text box by its **top** edge. `drawText` positions by the **baseline**.

```
ascentPdf = (fontkit.ascent / fontkit.unitsPerEm) * fontSize
pdfBaselineY = userSpaceTopY - ascentPdf
```

`heightAtSize(size, { descender: false })` is ascent-ish but uses `(ascent - 0) * scale / 1000 * size` only after subtracting `|descent|` from full height — it is **not** a reliable ascent. Read `ascent` / `unitsPerEm` from the same fontkit instance the embedder uses, or parse them once at app startup from the shipped TTF.

### Recommended strategy

1. Ship a small TTF set in `public/fonts/` (e.g. Liberation Sans / Serif / Mono — already in `pdfjs-dist/standard_fonts/`).
2. Editor overlay uses the same files via `@font-face` (not `next/font`, which subsets and would desync metrics).
3. Wrap and measure in the editor using a shared `measureText(fontId, size, text)` that either:
   - uses an OffscreenCanvas with that `@font-face` loaded, or
   - ports pdf-lib/fontkit metrics into a pure function used by both the overlay and the exporter.
4. Prefer (the fontkit-metrics function) as source of truth so wrap points are identical at export. Load fontkit once at module init.

---

## 6. Images

```ts
embedJpg(jpg: string | Uint8Array | ArrayBuffer): Promise<PDFImage>  // PDFDocument.ts:1030
embedPng(png: string | Uint8Array | ArrayBuffer): Promise<PDFImage>  // PDFDocument.ts:1070
image.scale(factor): { width, height }
image.scaleToFit(width, height): { width, height }  // PDFImage.ts
```

No WebP embedder. Browser path: `createImageBitmap` → canvas `toBlob('image/png')` (or JPEG if no alpha). Re-encoding grows PNGs (pdf-lib's `PngEmbedder` already inflates to raw RGB + optional SMask). Keep the original PNG/JPEG bytes on the image object when the upload already is one of those; convert only WebP.

---

## 7. Page operations

```ts
removePage(index: number): void           // shifts later indices; empty doc throws RemovePageFromEmptyDocumentError
insertPage(index, page?): PDFPage         // foreign page throws ForeignPageError
addPage(page?): PDFPage                   // insertPage(count, page)
copyPages(srcDoc, indices): Promise<PDFPage[]>
```

**Do not reorder by repeated `removePage`/`insertPage` on the source.** Index shifts are easy to get wrong. Export recipe:

```
const src = await PDFDocument.load(originalBytes);
const out = await PDFDocument.create();
const copied = await out.copyPages(src, editorPageOrder.map(p => p.sourceIndex));
for (const page of copied) out.addPage(page);
// then draw overlays onto out.getPages()[i]
```

`copy()` exists but its own comment says it drops acroforms/outlines (`PDFDocument.ts:747–748`). Fine for MVP.

Page references after `removePage` on the source are stale. Always work from a freshly copied page list.

---

## 8. Loading and errors

```ts
// PDFDocumentOptions.ts LoadOptions
{ ignoreEncryption?: boolean; parseSpeed?: ParseSpeeds | number;
  throwOnInvalidObject?: boolean; updateMetadata?: boolean; capNumbers?: boolean }
```

Defaults: `ignoreEncryption: false`, `parseSpeed: Slow (100)`, `throwOnInvalidObject: false`, `updateMetadata: true`.

Encrypted files throw `EncryptedPDFError` (`api/errors.ts:4–9`) with the message telling you about `ignoreEncryption: true`. Do **not** set that for the MVP — show "This PDF is password-protected." Corrupt files surface parser errors; `throwOnInvalidObject: true` makes them louder. Keep it `false` and still wrap `load` in try/catch.

---

## 9. Workers and memory

pdf-lib's `src/` has no `window` / `document` / `fs` usage in the API layer (grepped). It is safe in a Web Worker. `@pdf-lib/fontkit` should be imported only in that worker.

Pitfalls: `embedPng` decodes to raw RGB (peak memory ≈ width × height × 4); `copyPages` + `flush` duplicates page trees; `subset: true` still parses the full TTF. For large files, run export in a worker and transfer the `Uint8Array` out.

---

## Decisions and risks

1. Store objects in **displayed page space** (PDF.js viewport, top-left, points). Convert to pdf-lib user space only inside `lib/pdf/export-pdf.ts`.
2. Rotate around **center** in the editor. Export via an explicit CTM, not `drawX({ rotate })`.
3. Never trust `page.getSize()` for layout; persist viewport-derived page size at load.
4. Ship Liberation (or equivalent) TTFs; measure with fontkit; `@font-face` the same files. No `StandardFonts` for user text, no `next/font` on overlay text.
5. Drawings: `pushOperators` + `m`/`l`/`S` with Round cap/join. Skip `drawSvgPath`'s implicit `scale(1,-1)` unless tests prove it simpler.
6. Highlights: `BlendMode.Multiply` + fill opacity.
7. Page order: `copyPages` into a new document in editor order.
8. Reject encrypted PDFs. Convert WebP → PNG at insert time; keep original PNG/JPEG bytes.

### Risks

| Risk | Mitigation |
| --- | --- |
| `/Rotate` + CropBox mismatch vs PDF.js | Fixture tests at 0/90/180/270 and a non-zero CropBox |
| Center vs bottom-left rotation | Shared `toPdfCtm()` unit-tested; never pass `rotate` on high-level draws |
| Text wrap drift | One metrics function used by overlay and exporter |
| `drawSvgPath` Y-flip double-application | Prefer raw operators |
| pdf-lib unmaintained since 2021 | Treat shipped source as the spec; isolate behind `exportDocument()` |

### Not verified

- Empirical export of a `/Rotate 90` + non-zero CropBox PDF (algorithm derived from APIs, not executed).
- Exact `@pdf-lib/standard-fonts` throw string for an unencodable code point (error class path traced; message not captured).
- fontkit `ascent` units vs CSS `metrics.actualBoundingBoxAscent` on the same TTF (must measure during Phase 3).
- Worker + `pdf-lib` + `fontkit` bundle size under Turbopack (editor-runtime verified _a_ worker, not this one).
