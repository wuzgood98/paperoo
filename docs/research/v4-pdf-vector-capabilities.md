# V4 PDF vector capabilities

What the first existing-vector-editing milestone can extract, select, and rewrite with the libraries already installed: click a simple vector already in the PDF, move / resize / restyle / delete it, export, without rewriting the overlay editor.

This note follows [v4-existing-vector-graphics-editing.md](../../v4-existing-vector-graphics-editing.md). It records operator extraction, grouping, coordinate mapping, and export limits. It does not implement the editor.

Research notes live under `docs/research/`, next to [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md) and [v3-pdf-image-capabilities.md](./v3-pdf-image-capabilities.md).

Installed versions:

- `pdfjs-dist@6.3.289` ([package.json](../../package.json), [pdfjs-dist/package.json](../../node_modules/pdfjs-dist/package.json), runtime `version` export)
- `pdf-lib@1.17.1` and `@pdf-lib/fontkit@1.1.1` ([package.json](../../package.json))

Primary sources are the installed package types and source, Mozilla’s PDF.js API docs, pdf-lib’s API source, and ISO 32000-1:2008 path/graphics operators as reflected in those libs. Secondary write-ups are not used.

---

## There are no high-level PDF.js vector objects

`PDFPageProxy.getTextContent` returns glyph runs only ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1545–1553). Images and vectors are not on `TextItem`.

`PDFPageProxy.getOperatorList({ intent, annotationMode, … })` returns a `Promise<PDFOperatorList>` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1531–1536, 1390–1408).

`PDFOperatorList` is ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1440–1446):

| Field       | Meaning                                 |
| ----------- | --------------------------------------- |
| `fnArray`   | Operator function ids (`OPS.*` numbers) |
| `argsArray` | Arguments for each operator             |

There is no helper that returns lines, rectangles, or paths as semantic objects. Walk the list, track graphics state, and group path construction with the paint that consumes it.

Paperoo already calls this in [`PdfSession.open`](../../lib/pdf/session.ts) (lines 95–120) for image extraction:

```ts
page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
```

Reuse that same list (or the same call site) for vectors. Do not assume a second high-level API.

---

## Critical fact for this PDF.js version: `constructPath`

In `pdfjs-dist@6.3.289`, path construction operators are **not** left as separate `OPS.moveTo` / `OPS.lineTo` / `OPS.curveTo` / `OPS.rectangle` entries in the operator list that `getOperatorList` returns to the display thread.

The worker’s `buildPath` accumulates them into `state.pathBuffer` / `state.pathMinMax` ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35010–35084). On the next paint (`stroke`, `fill`, `fillStroke`, `clip`, `endPath`, …) it emits a single op ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35658–35684):

```text
OPS.constructPath  (= 91)
args = [paintFn, [Float32Array(pathBuffer) | null], minMax | null]
```

Where:

- `paintFn` is the consuming paint id (`OPS.stroke`, `OPS.fill`, `OPS.eoFill`, `OPS.fillStroke`, `OPS.clip`, `OPS.endPath`, …).
- `pathBuffer` is a packed `DrawOPS` command stream (below).
- `minMax` is an axial-aligned bbox in the coordinate space of the path points at emit time (before further display CTM), or `null` when the path is empty.

A queue optimizer can also fold `q` / `cm` / `constructPath` / `Q` when the transform is translation-only for stroke/fillStroke paints, baking the translation into the buffer and replacing four ops with one `constructPath` ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 5743–5785).

**Implement vector extraction against `OPS.constructPath`, not against raw `moveTo`/`lineTo`.** The low-level OPS ids still exist on the `OPS` enum and may appear if something bypasses `buildPath`, but the normal page stream path is coalesced.

`DrawOPS` packing ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 320–326; [util.d.ts](../../node_modules/pdfjs-dist/types/src/shared/util.d.ts) lines 173–179):

| `DrawOPS`          | Value | Payload                  |
| ------------------ | ----- | ------------------------ |
| `moveTo`           | 0     | `x, y`                   |
| `lineTo`           | 1     | `x, y`                   |
| `curveTo`          | 2     | `x1, y1, x2, y2, x3, y3` |
| `quadraticCurveTo` | 3     | `x1, y1, x2, y2`         |
| `closePath`        | 4     | (none)                   |

Rectangles are expanded in `buildPath` into move/line/line/line/close ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35017–35030). Degenerate zero-width/height rects become move → line → close.

Display consumes the buffer with `makePathFromDrawOPS` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 1769–1797) then dispatches `this[paintFn](opIdx, path)` from `CanvasGraphics.constructPath` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 11839–11867; [canvas.d.ts](../../node_modules/pdfjs-dist/types/src/display/canvas.d.ts) line 141).

**`DrawOPS` is typed in `util.d.ts` but is not in the public `pdf.d.ts` export list** (OPS is; DrawOPS is not). Hardcode the numeric table above for this installed version, or import from the internal types path and pin the version. Do not invent different opcodes.

---

## Operator ids that matter for vectors

`OPS` is exported from the public build ([pdf.d.ts](../../node_modules/pdfjs-dist/types/src/pdf.d.ts) export list; [util.d.ts](../../node_modules/pdfjs-dist/types/src/shared/util.d.ts) lines 228–323). Numeric values from the installed runtime:

### Path construction (coalesced → `constructPath`)

| `OPS` | Id | PDF | Notes |
| --- | --- | --- | --- |
| `moveTo` | 13 | `m` | Buffered, then `constructPath` |
| `lineTo` | 14 | `l` | Buffered |
| `curveTo` | 15 | `c` | Buffered as cubic |
| `curveTo2` | 16 | `v` | Rewritten to cubic with current point as first control ([buildPath](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) 35059–35068) |
| `curveTo3` | 17 | `y` | Rewritten to cubic with endpoint duplicated as second control (35070–35079) |
| `closePath` | 18 | `h` | Buffered |
| `rectangle` | 19 | `re` | Expanded to lines + close |
| **`constructPath`** | **91** | — | **What extractors see** |

### Paint / consume

| `OPS` | Id | Role |
| --- | --- | --- |
| `stroke` | 20 | Stroke path |
| `closeStroke` | 21 | Close then stroke (worker may prepend `DrawOPS.closePath`) |
| `fill` | 22 | Non-zero fill |
| `eoFill` | 23 | Even-odd fill |
| `fillStroke` | 24 | Fill + stroke |
| `eoFillStroke` | 25 | Even-odd fill + stroke |
| `closeFillStroke` | 26 | Close + fill + stroke |
| `closeEOFillStroke` | 27 | Close + eoFill + stroke |
| `endPath` | 28 | Discard path (no paint); often after clip setup |
| `clip` | 29 | Non-zero clip |
| `eoClip` | 30 | Even-odd clip |
| `rawFillPath` | 94 | Internal fill helper — treat as unsupported if seen |

### Graphics state / transforms

| `OPS`              | Id      | Role                               |
| ------------------ | ------- | ---------------------------------- |
| `setLineWidth`     | 2       | Stroke width                       |
| `setLineCap`       | 3       | Cap style 0/1/2                    |
| `setLineJoin`      | 4       | Join style 0/1/2                   |
| `setMiterLimit`    | 5       | Miter                              |
| `setDash`          | 6       | `[dashArray, dashPhase]`           |
| `setGState`        | 9       | ExtGState pairs; see opacity below |
| `save` / `restore` | 10 / 11 | `q` / `Q`                          |
| `transform`        | 12      | `cm` — multiply CTM                |

### Colors (after worker conversion)

Device gray / RGB / CMYK / named space `setFillColor` / `setStrokeColor` are rewritten to RGB hex before the list is shipped ([pdf.worker.mjs](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) lines 35430–35490):

| Emitted `OPS` | Id | Args shape |
| --- | --- | --- |
| `setFillRGBColor` | 59 | `[ "#rrggbb" ]` via `Util.makeHexColor` ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) lines 545–547) |
| `setStrokeRGBColor` | 58 | same |
| `setFillTransparent` | 93 | none — fill becomes transparent ([canvas](../../node_modules/pdfjs-dist/build/pdf.mjs) 12484–12486) |
| `setStrokeTransparent` | 92 | none |

Pattern fills stay on `setFillColorN` / `setStrokeColorN` with tiling/shading IR ([handleColorN](../../node_modules/pdfjs-dist/build/pdf.worker.mjs) 35149–35186). **Skip constructPath paints whose current fill/stroke is a pattern.**

`shadingFill` (62) paints a shading without a path — out of scope.

### Nesting / groups

| `OPS` | Id | Role |
| --- | --- | --- |
| `paintFormXObjectBegin` / `End` | 74 / 75 | Nested form; push CTM + matrix (same as V3 images) |
| `beginGroup` / `endGroup` | 76 / 77 | Transparency / isolation groups — treat paints inside as unsupported for V4 |

### Opacity

Not a dedicated paint op. `setGState` walks `[key, value]` pairs ([pdf.mjs](../../node_modules/pdfjs-dist/build/pdf.mjs) `CanvasGraphics.setGState` 11307–11360):

| Key                             | Meaning                              |
| ------------------------------- | ------------------------------------ |
| `ca`                            | Fill alpha → `current.fillAlpha`     |
| `CA`                            | Stroke alpha → `current.strokeAlpha` |
| `BM`                            | Blend mode → canvas composite op     |
| `SMask`                         | Soft mask — out of scope             |
| `LW` / `LC` / `LJ` / `ML` / `D` | Line style aliases                   |

Track `ca` / `CA` when present. Default both to `1` when unset (canvas defaults).

Paperoo already re-exports `OPS` from [`lib/pdf/pdfjs.ts`](../../lib/pdf/pdfjs.ts).

---

## How the current codebase extracts / edits text and images

Mirror these patterns; do not invent a second editor.

### Object model

[`EditorObject`](../../lib/editor/types.ts) stays overlay-only (`source: "overlay"`). Original PDF content lives beside it:

| Array on `EditorPage`           | Type              | Role                  |
| ------------------------------- | ----------------- | --------------------- |
| `objects`                       | `EditorObject`    | User-created overlays |
| `pdfTextObjects`                | `PdfTextObject`   | V2 extracted text     |
| `pdfImageObjects`               | `PdfImageObject`  | V3 extracted images   |
| _(proposed)_ `pdfVectorObjects` | `PdfVectorObject` | V4 extracted vectors  |

`PdfTextObject` / `PdfImageObject` fields that V4 should copy conceptually ([lib/editor/types.ts](../../lib/editor/types.ts) lines 114–168):

- Editor-owned: `id`, `pageId`, `type`
- Source trace: `sourceIndex` (images also `sourceId`)
- Displayed box: `x`, `y`, `width`, `height`, `rotation`
- Dirtiness originals: text keeps `originalText` / font originals; images keep `originalX/Y/Width/Height/Rotation` + `deleted` + replacement asset ids

### Extraction pipelines

| Content | Entry | Parser |
| --- | --- | --- |
| Text | `page.getTextContent()` in [`session.ts`](../../lib/pdf/session.ts) | [`extractPdfTextObjects`](../../lib/pdf/extract-text.ts) |
| Images | same open pass: `getOperatorList` + CTM walk | [`extractPdfImageObjects`](../../lib/pdf/extract-images.ts) |
| Vectors | **same `operatorList`**, second walker (or shared state machine) | new `extract-vectors.ts` |

Image extractor already tracks `save` / `restore` / `transform` / form begin-end / `clip` / `eoClip` ([extract-images.ts](../../lib/pdf/extract-images.ts) lines 134–224). Vector extraction needs the same CTM + clip flags, plus line style and colors.

Session timing: metadata is read **before** `page.cleanup()` ([session.ts](../../lib/pdf/session.ts) lines 95–131). Vectors only need the operator list (path buffers are inline), so one open-time pass is enough. No lazy `objs` decode unlike images.

### Selection / store / undo

[`editorStore`](../../lib/editor/store.ts):

- Overlay selection: `selectedObjectIds`
- PDF text: `selectedPdfTextId` + `patchPdfText` / `selectPdfText`
- PDF images: `selectedPdfImageId` + `commitPdfImage` / `patchPdfImage` / soft-delete on `deleteSelected`

History: `commit(..., recordHistory)` snapshots `HistorySnapshot` = `{ document, selectedObjectIds, currentPageId }` ([types.ts](../../lib/editor/types.ts) 186–190; [history.ts](../../lib/editor/history.ts)). PDF image/text ids are **not** in the snapshot today; document mutations still undo because `pdfImageObjects` / `pdfTextObjects` live on `EditorDocument`. Add `selectedPdfVectorId` the same way as images; put vector edits through `commit` so undo/redo works.

Dirty helpers live in [`object-utils.ts`](../../lib/editor/object-utils.ts) (`isPdfTextDirty`, `isPdfImageDirty`, `pdfImageCoverBox`). Add `isPdfVectorDirty` comparing current vs original geometry/styles/`deleted`.

### Coordinates

One canonical path (same as V2/V3):

```text
PDF user space (crop + content CTM)
        ↕  userPointToDisplayed / displayedToUserSpace
displayed page space (top-left, includes /Rotate)
        ↕  screenToPage / pageToScreen
mouse / CSS pixels
```

[`lib/editor/coordinates.ts`](../../lib/editor/coordinates.ts): `userPointToDisplayed`, `userBoxToDisplayed`, `displayedToUserSpace`, `multiplyCtm`, `IDENTITY_CTM`. Image placement uses CTM corners via `imageCtmToDisplayedBox`. For vectors, transform path points with the CTM at paint time, then map each point (or the `minMax` bbox) through `userPointToDisplayed`.

`getOperatorList` starts from identity CTM the same way `getTextContent` does ([v2 note](./v2-pdf-text-capabilities.md)). Page `/Rotate` is **not** in the operators — apply `sourceRotate` + `cropBox` in the coordinate helpers.

### Masking / export

[`exportDocument`](../../lib/pdf/export-pdf.ts):

1. `PDFDocument.load` original bytes → `copyPages` into a new doc.
2. Dirty PDF text: white `drawRectangle` + `drawText` (`drawDirtyPdfText`).
3. Dirty PDF images: white cover over **original** box + optional re-embed (`drawDirtyPdfImage`).
4. Overlay objects: shapes already use `drawLine` / `drawRectangle` / `drawEllipse` / raw `moveTo`+`lineTo`+`stroke` via `pushOperators`.

pdf-lib **appends** content streams; it cannot delete original operators ([v2 note](./v2-pdf-text-capabilities.md)). Vectors follow the same cover-then-redraw rule.

---

## Can vectors be obtained via `getOperatorList`?

**Yes.** That is the only reliable public path in this install.

What you get per painted vector (typical):

1. Preceding `setLineWidth` / `setLineCap` / `setLineJoin` / `setDash` / `setGState` / color ops (stateful; may be many ops earlier).
2. Zero or more `transform` / `save`/`restore` / form begin-end.
3. One `constructPath` whose args are `[paintFn, [DrawOPS buffer], minMax]`.

What you do **not** get:

- A `PdfVector` class or path object from PDF.js
- Guaranteed separate `moveTo`/`lineTo` ops in `fnArray`
- Fill/stroke color on the constructPath args themselves (read from tracked state)
- Semantic “this is a circle” (ellipses are Bézier sequences)

`render({ recordOperations: true })` can fill `recordedBBoxes` ([api.d.ts](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) lines 1378–1380, 1462) but requires a canvas render and is typed `any`. Prefer parsing `getOperatorList` + `minMax` / transformed path points, matching the image pipeline.

---

## How pdf-lib draws / replaces simple vectors

Installed `pdf-lib@1.17.1` high-level page APIs ([PDFPage.d.ts](../../node_modules/pdf-lib/es/api/PDFPage.d.ts)):

| Method | Use for V4 |
| --- | --- |
| `drawLine` | Axis line / two-point stroke ([PDFPageDrawLineOptions](../../node_modules/pdf-lib/es/api/PDFPageOptions.d.ts) 73–88): `start`, `end`, `thickness`, `color`, `opacity`, dash, lineCap |
| `drawRectangle` | Axis-aligned (or rotated via options) fill/stroke rect — already used for whiteouts and overlay shapes |
| `drawEllipse` / `drawCircle` | Only if extractor promotes a detected ellipse; otherwise keep as path |
| `drawSvgPath` | Arbitrary path string with fill/stroke/opacity ([PDFPageDrawSVGOptions](../../node_modules/pdf-lib/es/api/PDFPageOptions.d.ts) 58–72) |
| `pushOperators(...ops)` | Lowest level: `moveTo`, `lineTo`, `appendBezierCurve`, `closePath`, `rectangle`, `stroke`, `fill`, `fillAndStroke`, `setLineWidth`, `setStrokingRgbColor`, `setFillingRgbColor`, `pushGraphicsState` / `popGraphicsState`, `concatTransformationMatrix` ([operators.d.ts](../../node_modules/pdf-lib/es/api/operators.d.ts)) |

Paperoo already uses the low-level path for drawings/signatures and high-level draws for overlay shapes ([export-pdf.ts](../../lib/pdf/export-pdf.ts) `drawStrokePoints`, `drawShape`).

Whiteout/mask: same as images — `drawRectangle({ color: rgb(1,1,1), … })` over the **original** displayed→user box (optionally with bleed like `PDF_IMAGE_COVER_BLEED`). Then redraw the modified vector with pdf-lib. Failures on non-white / busy backgrounds are the same known limit as V2/V3.

Do **not** rasterize vectors to images on export (spec §18).

---

## Feasible V4 subset vs out of scope

### Feasible with current APIs

| Kind | How recognized | Edit | Export |
| --- | --- | --- | --- |
| Stroked line | `constructPath` + `stroke`/`closeStroke`; buffer is move+line (optionally close) | Move/resize bbox or endpoints; stroke color/width | `drawLine` or `pushOperators` |
| Filled / stroked rect | Buffer matches expanded `re` (4 lines + close) or classify as `rect` | Box edit + fill/stroke | `drawRectangle` |
| Simple path | Finite DrawOPS stream, solid RGB colors, no pattern | BBox move/resize via transform; style edits | `drawSvgPath` or raw operators |
| Fill + stroke | `fillStroke` / `eoFillStroke` / close variants | Both styles | fill then stroke, or `fillAndStroke` |
| Even-odd fill | `eoFill` / `eoFillStroke` | Store winding rule | Even-odd if pdf-lib path supports it; else document approx |

Reuse overlay `ShapeObject` / drawing export code paths where shapes match.

### Explicitly out of scope for this milestone

| Structure | Why |
| --- | --- |
| Clipping paths as editable objects | `constructPath` with `clip`/`eoClip` changes clip state; V3 already skips clipped content — skip selectable vectors while `clipped` |
| Soft masks (`SMask` in `setGState`) | Canvas soft-mask mode; appearance not a simple path |
| Patterns / shadings | `setFillColorN` tiling/shading IR; `shadingFill` |
| Blend modes other than Normal | `BM` in `setGState` — leave untouched |
| Transparency groups | `beginGroup` / `endGroup` |
| Nested form XObjects with complex content | Can track CTM like images, but skip if group/SMask/unsupported ops inside; prefer skip over wrong edit |
| Text drawn as paths | Indistinguishable from decorative paths without font/text ops nearby — leave untouched rather than fake text |
| Gradients as first-class edits | Shading patterns |
| Illustrator-style node editing | Spec §26 |
| Operator deletion / stream rewrite | pdf-lib cannot remove original ops |
| Skewed CTMs for “rect” promotion | Same perpendicular test as images (`IMAGE_SKEW_EPSILON`) |
| Dashes as editable UI (optional later) | `setDash` is readable; first UI can omit dash editing but should preserve on unmodified export (unmodified = draw nothing) |

Unsupported sequences: detect → do not create a `PdfVectorObject` → original canvas remains the source of truth.

---

## Recommended extraction model

Keep original vectors off the overlay union. Add `EditorPage.pdfVectorObjects`, parallel to text/images.

```ts
type PdfPathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | {
      type: "curveTo";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
    }
  | { type: "quadTo"; x1: number; y1: number; x2: number; y2: number }
  | { type: "closePath" };

type PdfVectorKind = "line" | "rect" | "path";

type PdfVectorObject = {
  id: string;
  type: "pdf-vector";
  pageId: string;
  kind: PdfVectorKind;

  // Displayed page space (top-left), same as PdfImageObject
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;

  originalX: number;
  originalY: number;
  originalWidth: number;
  originalHeight: number;
  originalRotation: number;

  // Path in **user space at paint time** (after CTM applied to DrawOPS points),
  // or keep raw DrawOPS + paintCtm and transform at render/export — pick one
  // and stick to it. Prefer storing displayed-space commands for hit-testing,
  // plus originalUserPath for export fidelity.
  path: PdfPathCommand[];

  fill: { color: string; opacity: number } | null;
  stroke: {
    color: string;
    opacity: number;
    width: number;
    lineCap: number;
    lineJoin: number;
  } | null;
  fillRule: "nonzero" | "evenodd";

  originalFill: PdfVectorObject["fill"];
  originalStroke: PdfVectorObject["stroke"];

  deleted: boolean;

  /** Index of the constructPath (or paint) op in fnArray */
  sourceIndex: number;
  /** Optional span of ops that belong to this paint (debug / future) */
  sourceOperatorIndices: number[];

  /** Paint OPS id that constructPath carried (stroke/fill/…) */
  paintOp: number;
};
```

### Grouping rules (state machine)

Walk `fnArray` like [`extractPdfImageObjects`](../../lib/pdf/extract-images.ts):

1. Maintain stack: `{ ctm, clipped, lineWidth, lineCap, lineJoin, dash, fillColor, strokeColor, fillAlpha, strokeAlpha, fillIsPattern, strokeIsPattern }`.
2. On `save` / `restore` / form begin-end: push/pop (copy image extractor behavior).
3. On `transform`: `ctm = multiplyCtm(ctm, args)`.
4. On line/color/`setGState` ops: update current state.
5. On `clip` / `eoClip` **paint** via `constructPath`: set `clipped = true` until matching restore; **do not** emit a vector.
6. On `constructPath` whose `paintFn` is a real paint (`stroke`/`fill`/…):
   - Skip if `clipped`, pattern color, active SMask/group unsupported, empty buffer, or non-finite points.
   - Decode DrawOPS → commands; apply CTM to each point.
   - Classify: line (1 segment), rect (closed 4-edge axis-aligned in user space), else `path`.
   - BBox: prefer transformed `minMax` corners through `userPointToDisplayed`, else bounds of transformed points (inflate by half `lineWidth` for stroke-only hit boxes if needed).
   - Emit one `PdfVectorObject` with `sourceIndex = i`.

Do not emit one object per DrawOPS command. One `constructPath` paint → one editor object.

### Kind classification heuristics

- **line**: exactly `moveTo` + `lineTo` (optional `closePath` only if stroke-close and segment count still 1).
- **rect**: closed path of four axis-aligned edges (from expanded `re` or equivalent), columns perpendicular — else keep as `path`.
- **path**: everything else supported.
- Do **not** invent `kind: "circle"` unless a dedicated detector proves four cubic arcs of an ellipse; Bézier-only circles stay `path` (spec §4).

### Store / UI wiring

- `selectedPdfVectorId` + `commitPdfVector` / `patchPdfVector` mirroring images.
- Soft `deleted: true` on delete.
- Hover/selection: interaction layer over PDF.js canvas; hit-test line distance / point-in-path / bbox for rects (spec §20) — do not rely only on bbox for thin diagonals.
- Unmodified: draw nothing in overlay; canvas keeps original.
- Dirty: optional editor preview of restyled path + white cover at export.

---

## Risks

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| **Clipping** | `constructPath` + `clip`/`eoClip`; later paints inherit clip until `restore` | Same `clipped` flag as images; never select clipped paints |
| **Nested transforms** | Multiple `cm` + form matrices; optimizer may bake translations into path buffers | Always compose CTM when applying; after optimizer, buffer points may already be translated — still apply remaining CTM |
| **Form XObjects** | `paintFormXObjectBegin/End` push matrix ([extract-images](../../lib/pdf/extract-images.ts) 165–172) | Track forms for CTM; skip forms that contain groups/SMask/patterns if unsure |
| **Patterns** | `setFillColorN` tiling/shading IR | Skip; leave original |
| **Soft masks** | `setGState` `SMask` | Skip page region or all following paints until clear — safest: skip any paint while SMask active |
| **Text-as-paths** | Outlined fonts become `constructPath` fills with no text ops | Prefer leaving dense small glyph-like paths alone; do not OCR |
| **Overlapping graphics** | Paint order = `fnArray` order; white cover hides everything under the bbox | Store `sourceIndex` as z-order; cover only when dirty; document white-mask damage to underlays (same as V2/V3) |
| **Stroke width under CTM** | Line width is in user space; non-uniform scale distorts stroke | Track CTM scale for displayed stroke width; on resize, prefer transforming path and decide whether stroke scales |
| **Thousands of ops** | Spec §22; TextLayer already caps DOM | Parse once at open; cache `pdfVectorObjects`; hit-test without React-per-path |
| **DrawOPS not public** | Missing from `pdf.d.ts` exports | Pin numeric table to `6.3.289` |
| **White mask** | `drawDirtyPdfText` / `drawDirtyPdfImage` comments | Document failure on non-white / image / vector backgrounds |
| **History selection** | `HistorySnapshot` omits PDF selection ids | Document mutations undo; selection may clear — acceptable if matching text/image |

---

## What to reuse

| Existing piece | Role |
| --- | --- |
| `EditorPage.pdfImageObjects` / `pdfTextObjects` | Pattern for `pdfVectorObjects` |
| `extractPdfImageObjects` CTM/clip/form walk | Shared or copied state machine |
| `OPS` from [`lib/pdf/pdfjs.ts`](../../lib/pdf/pdfjs.ts) | Operator ids |
| `displayedToUserSpace` / `userPointToDisplayed` / `multiplyCtm` | Extract + export |
| `screenToPage`, selection chrome, overlay gestures | Hover / move / resize |
| `commit` + `HistorySnapshot.document` | Undo/redo |
| `drawShape` / `drawStrokePoints` / `pushOperators` | Export redraw |
| White `drawRectangle` cover | Delete / restyle mask |
| Unmodified → PDF.js canvas [`render-page.ts`](../../lib/pdf/render-page.ts) | No second renderer |

---

## Known limits

- No semantic vector API in PDF.js 6.3.289 — only `getOperatorList` + `constructPath`.
- pdf-lib cannot remove original path operators; covers leave originals underneath.
- White covers fail on non-white and busy backgrounds (same as V2/V3).
- Pattern, shading, soft-mask, and clipped vectors stay uneditable.
- Exact CMYK is converted to RGB hex by the worker before the list arrives.
- Ellipse-as-circle is not first-class unless detected later.
- Encrypted PDFs already fail open/export.

---

## Milestone stop line

Upload a PDF with simple vectors → click one → select → move → resize → change fill/stroke where present → delete → undo/redo → export → reopen and see vector changes.

Data path:

1. `page.getOperatorList({ annotationMode: DISABLE })` already in session open.
2. Walk list; decode `OPS.constructPath` DrawOPS buffers with graphics state.
3. Store `PdfVectorObject[]` on the page; map through existing coordinates.
4. Export: cover dirty originals, redraw with pdf-lib line/rect/path APIs.

Stop there. Full graphics reconstruction, node editing, and stream rewriting wait on these results.

---

## Sources

- Mozilla PDF.js API: [PDFPageProxy.getOperatorList](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)
- Installed types: `node_modules/pdfjs-dist/types/src/display/api.d.ts`, `types/src/shared/util.d.ts` (`OPS`, `DrawOPS`), `types/src/display/canvas.d.ts`, `types/src/pdf.d.ts`
- Installed worker: `node_modules/pdfjs-dist/build/pdf.worker.mjs` (`buildPath`, constructPath emit, color→RGB hex, queue optimizer)
- Installed display: `node_modules/pdfjs-dist/build/pdf.mjs` (`DrawOPS`, `makePathFromDrawOPS`, `CanvasGraphics.constructPath` / `setGState` / stroke/fill)
- pdf-lib 1.17.1: `es/api/PDFPage.d.ts`, `es/api/PDFPageOptions.d.ts`, `es/api/operators.d.ts`, `es/api/operations.d.ts`
- ISO 32000-1:2008 path construction / painting / graphics state (as reflected by the OPS table above)
- Paperoo: [lib/editor/types.ts](../../lib/editor/types.ts), [lib/editor/coordinates.ts](../../lib/editor/coordinates.ts), [lib/editor/store.ts](../../lib/editor/store.ts), [lib/editor/object-utils.ts](../../lib/editor/object-utils.ts), [lib/pdf/session.ts](../../lib/pdf/session.ts), [lib/pdf/extract-images.ts](../../lib/pdf/extract-images.ts), [lib/pdf/extract-text.ts](../../lib/pdf/extract-text.ts), [lib/pdf/export-pdf.ts](../../lib/pdf/export-pdf.ts), [docs/research/v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md), [docs/research/v3-pdf-image-capabilities.md](./v3-pdf-image-capabilities.md)
