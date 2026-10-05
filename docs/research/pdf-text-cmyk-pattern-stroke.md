# PDF text colors: CMYK, patterns, stroke (`Tr`)

Follow-on to [pdf-text-extract-colors.md](./pdf-text-extract-colors.md) (Phase 2 fill zip) and [pdf-text-inline-edit-followups.md](./pdf-text-inline-edit-followups.md) §1. Covers three gaps left out of the fill-RGB path: DeviceCMYK, pattern fills (`scn` / `setFillColorN`), and stroke-aware text rendering mode (`Tr` / `setTextRenderingMode`).

This note does not implement product code.

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`.

Primary sources: PDF.js OPS / PartialEvaluator / canvas in `node_modules/pdfjs-dist`, pdf-lib color + text operators in `node_modules/pdf-lib/src`, and paperoo `extract-text-colors` / `extract-vectors` / `export-pdf` / `types`.

---

## Current `extract-text-colors.ts` — support vs reject

Implemented in [`lib/pdf/extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts); wired in [`session.ts`](../../lib/pdf/session.ts) → `extractPdfTextObjects(..., itemColors)`.

### Supported

| Signal | Behavior | Cite |
| --- | --- | --- |
| `setFillRGBColor` | Parse hex string or 0–1 RGB → `#rrggbb`, `fillOk: true` | `extract-text-colors.ts` 173–178 |
| `setFillGray` | Gray → RGB hex, `fillOk: true` | 181–186 |
| Default fill | `#000000`, `fillOk: true`, `Tr = FILL (0)` | `defaultState` 107–111 |
| `save` / `restore` | Stack fill + `fillOk` + `textRenderingMode` | 152–160 |
| `setTextRenderingMode` | Update mode; paint only when mode needs fill | 163–170, `needsFill` 118–125 |
| `showText` / `showSpacedText` / `nextLineShowText` / `nextLineSetSpacingShowText` | Push `paintColor(state)` | 127–131, 203 |
| Zip | Paintable items = `str` not `" "` / `""`; count gate + same-color recovery | `zipPdfTextItemColors` 239–277 |

`needsFill` treats low 2 bits like PDF.js `FILL_STROKE_MASK`: modes **0 (FILL)** and **2 (FILL_STROKE)** sample fill; **1 (STROKE)** and **3 (INVISIBLE)** do not (`extract-text-colors.ts` 8–11, 118–125; PDF.js `TextRenderingMode` in [`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 98–109).

### Rejected (→ `fillOk: false` → paint `null`)

| Op | Effect | Cite |
| --- | --- | --- |
| `setFillCMYKColor` | `fillOk: false` | 189–196 |
| `setFillColorN` | `fillOk: false` | same |
| `setFillColor` | `fillOk: false` | same |
| `setFillTransparent` | `fillOk: false` | same |
| Stroke-only `Tr` | `needsFill` false → `paintColor` returns `null` even if fill RGB is known | 133–137; test `extract-text-colors.test.ts` 80–96 |

Any `null` paint fails the whole zip to `DEFAULT_PDF_TEXT_COLOR` (`#111827`) unless same-color recovery applies ([pdf-text-extract-colors.md](./pdf-text-extract-colors.md)).

### Not tracked at all

- Stroke color ops (`setStrokeRGBColor`, `setStrokeGray`, `setStrokeCMYKColor`, `setStrokeColorN`, …)
- `setLineWidth` (relevant for stroked text)
- Pattern IR contents (only the op id is seen and rejected)

---

## How `extract-vectors.ts` handles CMYK / patterns / stroke

[`lib/pdf/extract-vectors.ts`](../../lib/pdf/extract-vectors.ts) is the template for dual fill+stroke state.

| Topic | Behavior | Cite |
| --- | --- | --- |
| Fill RGB / gray | Same hex parsers as text colors | 596–617 |
| Stroke RGB / gray | Parallel `stroke` / `strokeOk` | 604–625 |
| CMYK / ColorN / Color / Transparent | Set `fillOk` and/or `strokeOk` false by op family — **no conversion** | 628–654 |
| Paint gate | Skip vector if paint needs fill and `!fillOk`, or needs stroke and `!strokeOk` | 685–690 |
| Emitted styles | Hex-only `PdfVectorFillStyle` / `PdfVectorStrokeStyle` | 195–203 in `types.ts`; emit 702–712 |
| Patterns | Unreproducible as hex → object omitted (not extracted) | same gate |

Vectors never store CMYK components or pattern handles. Text Phase 2 copied the fill-reject pattern but did not copy stroke tracking.

---

## How PDF.js exposes these ops

### OPS ids ([`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 265–288; [`util.d.ts`](../../node_modules/pdfjs-dist/types/src/shared/util.d.ts) 270–293)

| Name                                          | Id      |
| --------------------------------------------- | ------- |
| `setTextRenderingMode`                        | 38      |
| `setStrokeColor` / `setStrokeColorN`          | 52 / 53 |
| `setFillColor` / `setFillColorN`              | 54 / 55 |
| `setStrokeGray` / `setFillGray`               | 56 / 57 |
| `setStrokeRGBColor` / `setFillRGBColor`       | 58 / 59 |
| `setStrokeCMYKColor` / `setFillCMYKColor`     | 60 / 61 |
| `setStrokeTransparent` / `setFillTransparent` | 92 / 93 |

### `TextRenderingMode` ([`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 98–109)

| Value | Name | Paint |
| --- | --- | --- |
| 0 | `FILL` | fill |
| 1 | `STROKE` | stroke |
| 2 | `FILL_STROKE` | fill + stroke |
| 3 | `INVISIBLE` | neither |
| 4–7 | `*_ADD_TO_PATH` / `ADD_TO_PATH` | low bits + clip-to-path flag (`ADD_TO_PATH_FLAG = 4`) |

Canvas text uses `fillStrokeMode = textRenderingMode & FILL_STROKE_MASK` (`FILL_STROKE_MASK = 3`) to decide fill vs stroke ([`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 12122–12123, 12252–12254).

### Critical: PartialEvaluator rewrites solid colors to RGB hex

In `getOperatorList`, the worker **does not leave** DeviceCMYK / DeviceGray / DeviceRGB numeric ops for the display list. It converts and rewrites ([`pdf.worker.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs) 41504–41548):

- `setFillGray` / `setStrokeGray` → `setFillRGBColor` / `setStrokeRGBColor` with `getRgbHex`
- `setFillCMYKColor` / `setStrokeCMYKColor` → same, via `ColorSpaceUtils.cmyk.getRgbHex`
- `setFillRGBColor` / `setStrokeRGBColor` → args become hex string
- Non-pattern `setFillColor` / `setFillColorN` with a base color space → RGB hex
- Pattern space `setFillColorN` / `setStrokeColorN` → stays `setFillColorN` / `setStrokeColorN` with tiling/shading IR via `handleColorN` (41207–41244, 41550–41598)

So for paperoo’s consumer of `getOperatorList`:

1. **DeviceCMYK body text already arrives as `setFillRGBColor("#…")`.** Phase 2 already recovers it as display RGB. The `setFillCMYKColor` branch in `extract-text-colors.ts` is defensive for residual ops that the normal path should not emit.
2. **CMYK → RGB is lossy.** `DeviceCmykCS` uses a polynomial `#toRgb` ([`pdf.worker.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs) 8115–8127), not a reversible mapping. Original C/M/Y/K components are discarded before paperoo sees the list.
3. **Patterns stay as `setFillColorN`.** Rejecting them (`fillOk: false`) is correct; there is no single hex.

Display handlers: `setFillColorN` sets `patternFill = true` and stores a pattern object ([`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 12462–12466); `setFillRGBColor` clears pattern fill (12478–12482). Stroked text with patterns uses `patternStroke` the same way (12457–12460, 12269–12278).

---

## pdf-lib: CMYK text fill / stroke on export?

### Fill color — yes (RGB, gray, or CMYK)

[`colors.ts`](../../node_modules/pdf-lib/src/api/colors.ts): `rgb`, `grayscale`, `cmyk`, `setFillingColor`, `setStrokingColor`.

[`PDFPageDrawTextOptions`](../../node_modules/pdf-lib/src/api/PDFPageOptions.ts) 21–35: `color?: Color` (any of the three).

[`PDFPage.drawText`](../../node_modules/pdf-lib/src/api/PDFPage.ts) 965–1014 → `drawLinesOfText` which always emits **`setFillingColor`** only ([`operations.ts`](../../node_modules/pdf-lib/src/api/operations.ts) ~78–103). Docs explicitly show `cmyk(...)` as a fill color ([`PDFPage.ts`](../../node_modules/pdf-lib/src/api/PDFPage.ts) 729–735).

Paperoo export today: hex → `rgb()` only ([`export-pdf.ts`](../../lib/pdf/export-pdf.ts) `color` helper 92–95; `drawDirtyPdfText` 276–282).

### Stroke / `Tr` — not via `drawText`

- `drawText` / `drawLinesOfText` never call `setTextRenderingMode` or `setStrokingColor`.
- Low-level APIs exist: `setTextRenderingMode(TextRenderingMode)` with `Fill=0`, `Outline=1`, `FillAndOutline=2`, … ([`operators.ts`](../../node_modules/pdf-lib/src/api/operators.ts) 232–244); `setStrokingColor` / `setStrokingCmykColor` / `setLineWidth`.
- Stroke or fill+stroke dirty text requires **`page.pushOperators(...)`** (beginText → font → rendering mode → fill and/or stroke colors → line width → showText → endText), not plain `drawText`.

### Pattern fills — no high-level API

pdf-lib has no tiling/shading pattern paint helper comparable to PDF.js `setFillColorN` IR. Pattern text cannot be round-tripped through the current export stack.

---

## Which `Tr` modes matter for paperoo

| Mode | Spec / PDF.js | Extract today | Product need |
| --- | --- | --- | --- |
| 0 Fill | Normal body text | Sample fill ✓ | Keep; inspector fill ColorField (already) |
| 1 Stroke | Outline / hollow text | Paint `null` → fail closed | Track stroke RGB; preview + export stroke |
| 2 Fill+Stroke | Filled with outline | Samples fill only; ignores stroke | Track both; dual ColorFields |
| 3 Invisible | OCR / position-only | Paint `null` | Keep fallback; do not offer color edit as “ink” |
| 4–7 Add-to-path | Clip construction | Rare for editable runs | Fail closed / ignore (same as invisible for ink) |

Model/UI implications:

- Add `textRenderingMode: number` (default 0) and `originalTextRenderingMode`.
- Keep `color` / `originalColor` as **fill** hex (nullable or unused when mode is stroke-only).
- Add `strokeColor` / `originalStrokeColor` (and optionally `strokeWidth` / `originalStrokeWidth` from `setLineWidth` at paint time).
- Dirty: include mode + stroke fields in `isPdfTextDirty`.
- Inspector: show fill ColorField when mode needs fill; stroke ColorField (+ width) when mode needs stroke. Do not invent a pattern picker.
- Preview (`pdf-text-layer`): dirty CSS must use `-webkit-text-stroke` / `paint-order` (or SVG) for modes 1–2; fill-only `color` is insufficient for stroke-only.
- Invisible (3): leave canvas; if user edits string, export as fill mode 0 with chosen color (document as intentional mode collapse).

---

## Recommended implementation path (locked)

One pipeline, in this order. No alternate CMYK color model; no pattern editing.

### 1. Extract — extend the existing walk (do not fork)

In `extract-text-colors.ts`, mirror vector stroke state:

1. Add OPS: `setStrokeRGBColor`, `setStrokeGray`, `setStrokeCMYKColor`, `setStrokeColorN`, `setStrokeColor`, `setStrokeTransparent`, `setLineWidth`.
2. Graphics state: `stroke`, `strokeOk`, `lineWidth` alongside fill.
3. Solid stroke RGB/gray → hex (`strokeOk: true`); CMYK/ColorN/Color/Transparent stroke → `strokeOk: false` (same as vectors). Residual solid CMYK ops: optional defensive `readCmyk`→hex using PDF.js-style conversion is **not required** for DeviceCMYK pages because the worker already rewrote them to RGB hex.
4. On each show op, emit a paint record:
   - `fill: string | null` if mode needs fill and `fillOk`
   - `stroke: string | null` if mode needs stroke and `strokeOk`
   - `mode`, `lineWidth`
   - Entire paint is “unsupported” (`null` slot for zip) only when a **needed** channel is missing (pattern / transparent / invisible).
5. Zip: keep count gate + same-color recovery on the **primary ink** used for alignment (fill if present else stroke). Fail closed when any paintable slot is unsupported. Patterns stay unsupported.

**CMYK:** treat as already handled by PDF.js rewrite → Phase 2 RGB path. Document only; no `cmyk` fields on `PdfTextObject`.

**Patterns:** keep reject; no UI.

### 2. Model — `PdfTextObject`

| Field | Role |
| --- | --- |
| `color` / `originalColor` | Fill hex (existing) |
| `strokeColor` / `originalStrokeColor` | Stroke hex; default `#000000` when unused |
| `strokeWidth` / `originalStrokeWidth` | Optional; default from PDF default line width semantics when stroked |
| `textRenderingMode` / `originalTextRenderingMode` | 0–7; product UI cares about 0–2 |

Extract sets originals equal to currents. Session wiring stays in `session.ts`.

### 3. Preview

Dirty PDF text layer uses `object.color` for fill; for mode 1/2 apply CSS stroke from `strokeColor` / `strokeWidth` (scaled to CSS px). Clean (non-dirty) runs stay on the PDF.js canvas (correct CMYK→RGB and patterns already painted there).

### 4. Export

`drawDirtyPdfText`:

- Always white-cover original box (existing limit).
- Mode 0: keep `page.drawText({ color: rgb(...) })`.
- Mode 1/2: `pushOperators` with `setTextRenderingMode`, `setFillingColor` and/or `setStrokingColor`, `setLineWidth`, embedded font, `showText`.
- Always emit RGB from hex (no CMYK round-trip — components were lost at extract).

### 5. Inspector

- Fill ColorField when `mode ∈ {0,2}` (existing).
- Stroke ColorField (+ width) when `mode ∈ {1,2}`.
- Mode itself read-only initially (preserve extracted `Tr`); changing mode is a later enhancement.

---

## Risks

| Risk | Severity | Notes |
| --- | --- | --- |
| Order skew (show ops ≠ text items) | High | Unchanged from Phase 2; fail closed + same-color recovery |
| Pattern unreproducibility | High for those runs | Hex cannot represent tiling/shading; reject is correct; one patterned paint nulls whole-page zip today |
| CMYK conversion accuracy | Medium | Display RGB ≠ print CMYK; export RGB will not match press separations |
| Stroke width / CTM | Medium | Text stroke width is in user space and affected by text matrix scale (PDF.js adjusts in canvas ~12255–12268); preview CSS px needs careful scale |
| Fill+stroke dirty CSS | Medium | Browser text-stroke ≠ PDF exact; export operators are source of truth |
| Page-wide fail-closed | Medium | One pattern or stroke-unsupported paint zeros all extracted colors on that page |
| Invisible / add-to-path | Low | Rare; keep fallback |

---

## Acceptance criteria

1. **CMYK solid fill text** (DeviceCMYK `k`/`K` in source): after open, `PdfTextObject.color` matches PDF.js canvas ink within 1/255 per channel for aligned pages (via existing RGB rewrite + Phase 2 zip). No CMYK fields required.
2. **Pattern-filled text**: extract does not invent a hex; zip fails closed (or per-slot fallback) without crashing; canvas remains correct until dirty.
3. **Stroke-only (`Tr=1`)**: aligned pages set `textRenderingMode === 1`, `strokeColor` from op-list stroke RGB/gray; fill color unused for preview ink; dirty preview shows outline; export uses `setTextRenderingMode(Outline)` + stroking color.
4. **Fill+stroke (`Tr=2`)**: both colors extracted; dirty preview and export paint both; inspector exposes both ColorFields.
5. **Regression**: RGB/gray fill `Tr=0` cases in `test/extract-text-colors.test.ts` still pass; new unit tests for stroke mode, stroke RGB sample, pattern → unsupported, and zip with stroke-only paints.
6. **Export round-trip visual**: dirty stroke text in a fixture PDF opens in a reader with outline (not filled black/default).

---

## File touch list

| Path | Change |
| --- | --- |
| [`lib/pdf/extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts) | Stroke state, paint records, OPS surface |
| [`lib/pdf/extract-text.ts`](../../lib/pdf/extract-text.ts) | Map new fields from item color/paint parallel arrays |
| [`lib/pdf/session.ts`](../../lib/pdf/session.ts) | Pass enriched paints into extract |
| [`lib/editor/types.ts`](../../lib/editor/types.ts) | `strokeColor*`, `strokeWidth*`, `textRenderingMode*` |
| [`lib/editor/object-utils.ts`](../../lib/editor/object-utils.ts) | Dirty compare for new fields |
| [`components/editor/pdf-text-layer.tsx`](../../components/editor/pdf-text-layer.tsx) | Dirty CSS fill + stroke |
| [`components/editor/pdf-text-inspector.tsx`](../../components/editor/pdf-text-inspector.tsx) | Conditional stroke ColorField / width |
| [`lib/pdf/export-pdf.ts`](../../lib/pdf/export-pdf.ts) | `drawDirtyPdfText` mode 1/2 via `pushOperators` |
| [`test/extract-text-colors.test.ts`](../../test/extract-text-colors.test.ts) | Stroke / pattern / mode cases |
| This note | Living cite for scope |

Out of scope for this milestone: pattern editing, DeviceCMYK round-trip export, ICC profile fidelity, Type3 nested color, geometry-based zip.

---

## Sources

- PDF.js `OPS` / `TextRenderingMode`: [`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 98–109, 265–318; [`util.d.ts`](../../node_modules/pdfjs-dist/types/src/shared/util.d.ts) 270–388
- PartialEvaluator color rewrite + `handleColorN`: [`pdf.worker.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs) 41207–41244, 41504–41598
- `DeviceCmykCS.#toRgb`: [`pdf.worker.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs) 8115–8127
- Canvas fill/stroke text + `setFillColorN`: [`pdf.mjs`](../../node_modules/pdfjs-dist/build/pdf.mjs) 12116–12278, 12457–12488
- pdf-lib colors / `drawText` / `setTextRenderingMode`: [`colors.ts`](../../node_modules/pdf-lib/src/api/colors.ts), [`PDFPageOptions.ts`](../../node_modules/pdf-lib/src/api/PDFPageOptions.ts), [`operations.ts`](../../node_modules/pdf-lib/src/api/operations.ts), [`operators.ts`](../../node_modules/pdf-lib/src/api/operators.ts) 232–353
- Paperoo: [`extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts), [`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts), [`export-pdf.ts`](../../lib/pdf/export-pdf.ts), [`types.ts`](../../lib/editor/types.ts)
- Prior notes: [pdf-text-extract-colors.md](./pdf-text-extract-colors.md), [pdf-text-inline-edit-followups.md](./pdf-text-inline-edit-followups.md)
