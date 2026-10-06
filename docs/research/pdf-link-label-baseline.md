# PDF link label — baseline and underline gap after edit

Follow-on to [pdf-link-label-style.md](./pdf-link-label-style.md) and [v5-pdf-link-editing.md](./v5-pdf-link-editing.md). Edited captions sat above their original baseline while the sampled blue rule stayed put, so the gap grew and a short mark remained on the left of the rule.

Installed: `pdfjs-dist@6.3.289`, `pdf-lib@1.17.1`.

Primary sources: ISO 32000-1:2008 §8.4.3.2–§8.4.3.3 (stroke centered, butt cap), §9.4.2 / §9.4.4 (text baseline / `Trm`), §9.3.1 `Ts`, §12.5.6.5 (Link has no caption appearance). PDF.js `getCurrentTextTransform` and `TextLayer.#appendText`. pdf-lib `CustomFontEmbedder.heightOfFontAtSize`.

---

## What the user sees

Unedited neighbors (e.g. `GitHub`) stay on the content stream. Edited labels (`Portfolios`, `LinkedIns`) are dirty runs: white cover, replacement glyphs, redrawn rule ([`PdfTextLayer`](../components/editor/pdf-text-layer.tsx), [`drawDirtyPdfText`](../lib/pdf/export-pdf.ts)). The link annotation does not paint that text.

---

## Why the label moves up

ISO 32000-1 §9.4.2: glyphs are painted from a baseline origin. PDF.js stores that origin in `transform[4]`, `transform[5]`, with `Ts` already in the text matrix (`pdf.worker.mjs` `getCurrentTextTransform`, `Tsm` ~35872). `textContent.styles[loadedName].ascent` is `font.ascent` (~35891); for TrueType that is `hhea.ascent / unitsPerEm` (~28496).

Extraction builds a displayed box around that origin ([`textItemToDisplayedBox`](../lib/editor/coordinates.ts)): top is `fontSize * style.ascent` above the baseline; the bottom is at least `0.25em` below it (`DEFAULT_DESCENT_FLOOR`). That pad is not the shift.

Export ignored the matrix:

```ts
ascent = font.heightAtSize(size, { descender: false });
textY = user.y + user.height - ascent;
```

Dirty sans text embeds Liberation via pdf-lib’s custom-font path. `CustomFontEmbedder.heightOfFontAtSize` with `descender: false` subtracts `Math.abs(descent)` in **raw font units** from a height already scaled into 1000-unit space. Liberation hhea is ascent `1854`, descent `-434`, unitsPerEm `2048` (true ratio `0.905`). `heightAtSize(1000, { descender: false })` returns `683.1875`. The standard-font embedder does this correctly (`height += Descender` in 1000 units).

Drawn baseline is then `0.222em` too high for a Liberation-like face (`0.905 - 0.683`). The rule is sampled from original pixels and stroked at `fitted.y + offsetFromRunTop`, so it does not follow the glyphs. `transform[5]` already includes text rise and cannot be recovered from `height` and `fontSize` once the descent floor clamps.

[v2-pdf-text-capabilities.md](./v2-pdf-text-capabilities.md) documented `user.height - ascent` as if pdf-lib’s no-descender height were the extract ascent. For Liberation it is not. [pdf-link-label-style.md](./pdf-link-label-style.md) left `drawDirtyPdfText` positioning alone.

---

## Preview vs export

The overlay is a smaller, separate error. [`PdfTextLayer`](../components/editor/pdf-text-layer.tsx) used `line-height: 1` top-aligned in a box taller than the em. PDF.js TextLayer sets the span top to `baseline - fontSize * (fontBoundingBoxAscent / (ascent + descent))` (`pdf.mjs` `#appendText` ~15234, `#getAscent` ~~15365). Liberation’s win metrics are `1854 + 434 = 2288` (`1.117em`); with `line-height: 1` the CSS baseline sits near `0.846em` below the box top instead of `0.905em` (~~`0.06em` high). Export is the `0.222em` jump.

`PdfTextCaptionUnderline.offsetFromRunTop` is the **line center**. PDF stroke width is centered on the path (ISO 32000-1 §8.4.3.2). The preview used that number as CSS `top`, so the bar hung `thickness / 2` too low.

---

## Dark tick on the left of the rule

pdf-lib cannot delete the original `Tj` or path. The white rectangle was exactly the advance box. The text origin is the baseline origin, not the ink bounds, so anything left of `transform[4]` remains: a negative left side bearing, or a rule that starts left of the run.

Replacement Liberation `P` / `L` start at `+0.082em` (glyph `bbox.minX` 168 / 2048). Raised glyphs miss that sliver. The leftover is original ink on the original baseline, just above the blue rule.

The new `drawLine` is not the tick: pdf-lib emits an extra `moveTo` before the segment, and the default cap is butt (ISO 32000-1 §8.4.3.3).

---

## Fix

Anchor dirty PDF text to `transform`, not to `heightAtSize(..., { descender: false })`.

| Piece | Behavior |
| --- | --- |
| Export baseline | [`pdfTextBaselineUserSpace`](../lib/editor/coordinates.ts) → `transform[5]` after crop/rotate; X from the fitted box |
| Preview baseline | CSS ink top = displayed `transform[5]` minus Liberation `emHeightAscent` (fallback `1854/2048`) |
| Underline | Preview `top` = `offsetFromRunTop - thickness / 2`; export already strokes the center |
| Cover | Outset left by `0.15em` and through the rule so leftover ink is painted out |

Do not patch pdf-lib. A corrected Liberation ascent (`0.905`) would still miss the source font’s `style.ascent`.

---

## Tests

- [`test/coordinates.test.ts`](../../test/coordinates.test.ts) — matrix baseline survives the descent-floor box; `0.683em` formula does not.
- [`test/export-pdf-link.test.ts`](../../test/export-pdf-link.test.ts) — exported caption `transform[5]` matches the original run.
- [`test/object-utils.test.ts`](../../test/object-utils.test.ts) — underline CSS top and cover pad.
- [`test/liberation-font-metrics.test.ts`](../../test/liberation-font-metrics.test.ts) — pdf-lib no-descender height stays `683.1875`.
