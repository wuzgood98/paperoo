# PDF text fill color extraction (op-list zip)

Phase 2 after the ColorField shipped with `DEFAULT_PDF_TEXT_COLOR` (`#111827`). Recovers real fill hex from `getOperatorList` and assigns it onto `getTextContent` items only when a count-gated aligner succeeds.

Related: [pdf-text-inline-edit-followups.md](./pdf-text-inline-edit-followups.md), [v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md).

Installed: `pdfjs-dist@6.3.289`.

---

## Why not TextItem color

`TextItem` / `TextStyle` have no color fields ([`api.d.ts`](../../node_modules/pdfjs-dist/types/src/display/api.d.ts) 312–378). Confirmed in [v2](./v2-pdf-text-capabilities.md).

`getOperatorList` exposes fill ops and `showText*` after PartialEvaluator translation. Session already awaits both lists before `cleanup()` ([`session.ts`](../../lib/pdf/session.ts)).

---

## Two pipelines, one stream

| API | Walk | Color? |
| --- | --- | --- |
| `getTextContent` | Separate PartialEvaluator text builder | No |
| `getOperatorList` | Op-list translation | Yes — colors rewritten to RGB hex |

### Op-list normalization

([`pdf.worker.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs) ~41417–41542):

- Gray / CMYK / `sc` → `OPS.setFillRGBColor` with hex
- `showSpacedText` / `nextLineShowText` / `nextLineSetSpacingShowText` → `showText` (sometimes after `nextLine`)

Display OPS ([`pdf.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.mjs) ~6475–6566): `showText` 44, `showSpacedText` 45, `nextLineShowText` 46, `nextLineSetSpacingShowText` 47, `setTextRenderingMode` 38, `setFillGray` 57, `setFillRGBColor` 59.

Default canvas fill is `#000000`.

### Text-content chunking ≠ one paint → one item

([`pdf.worker.mjs`](../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs) ~41911–42487):

- Adjacent same-baseline `Tj` runs can **merge** into one `TextItem`
- `pushWhitespace` / `addFakeSpaces` insert exact `{ str: " " }` with no matching show op
- `appendEOL` can push `{ str: "", hasEOL: true }`
- Form XObjects: text content recurses; op list inlines between `paintFormXObjectBegin` / `End`

### Empirical alignment

| Case | Paints | Items (raw) | After drop `" "` / `""` | Zip? |
| --- | --- | --- | --- | --- |
| Separate colored lines | N | N (+ optional spaces) | N | Aligns |
| `"Hello World"` one Tj | 1 | 1 | 1 | Aligns |
| Large inter-word gap | 2 | 3 (word, `" "`, word) | 2 | Aligns if spaces filtered |
| Adjacent baseline, **different** colors | 2 | 1 (`"HiThere"`) | 1 | **Fail closed** |
| Adjacent baseline, **same** color | 2 | 1 | 1 | Same-color recovery |

---

## Locked algorithm

Implemented in [`lib/pdf/extract-text-colors.ts`](../../lib/pdf/extract-text-colors.ts).

1. **Paint walk** — track fill + `fillOk` + `Tr` with save/restore (vector color pattern). Include form-nested `showText*`. Do **not** clear fill on `setGState` (ExtGState is alpha/font/SMask, not fill RGB — unlike vector `unsafe`). On each show op that needs fill: push hex or `null`.
2. **Zip** — paintable items = `str` defined and `str !== " "` and `str !== ""` (exact filter, not `trim()`).
   - If any paint is `null`, or paint count ≠ paintable count → **fail closed**: every slot = `DEFAULT_PDF_TEXT_COLOR` (`#111827`).
   - Else zip by order; synthetic slots keep fallback.
   - **Same-color recovery**: more paints than paintable items and every paint hex is identical → assign that hex to all paintable items (aligned). Fewer paints than items still fail closed.
3. **Consume** — [`extractPdfTextObjects`](../../lib/pdf/extract-text.ts) takes optional `itemColors` parallel to `content.items`; sets `color` and `originalColor`.

Stroke-only `Tr`, patterns / `setFillColorN`, Type3 nested colors, geometry-based zip: out of scope (fallback).

---

## Sources

- PDF.js OPS / `TextRenderingMode` / canvas fill: `pdf.mjs` ~6346–6566, ~18711–18713
- PartialEvaluator color + showText rewrite: `pdf.worker.mjs` ~41417–41542
- Fake spaces / text builder: `pdf.worker.mjs` ~41911–42487
- Vector fill walk (pattern only): [`extract-vectors.ts`](../../lib/pdf/extract-vectors.ts)
- Phase-1 deferral: [pdf-text-inline-edit-followups.md](./pdf-text-inline-edit-followups.md) §1
