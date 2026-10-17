# Vector-test PDF audit

`test/fixtures/vector-test.pdf` is a 3-page ReportLab file:

- Page 1: paths, dashes, caps and joins, curves, and 0.25pt hairlines.
- Page 2: axial and radial shadings inside clips, `/ca` alpha, a star clip, `7 Tr` text followed by `sh`, and `1 Tr` text.
- Page 3: the standard-14 fonts (no embedding, WinAnsi), rotated text, stretched text, and a `T*` paragraph.

How these findings were gathered:

- Loaded the file in the dev server and edited it there.
- Captured the export in the page and reopened it.
- Decoded the exported content streams.
- Traced each finding to the code and to pdf.js 6.3.289.

## Findings

| # | Finding | Evidence | Source |
| --- | --- | --- | --- |
| 1 | Resizing a straight line exports a stroke of about 10^6 pt (a page-tall black bar). | Export wrote `1497613.39 w`. | Extraction floors a flat axis to 1e-4 (`lib/pdf/extract-vectors.ts`, `VECTOR_MIN_AXIS`). `resizeRotatedBox` then clamped the flat axis to `MIN_OBJECT_SIZE` (8), and the export stroke scale averaged both axis ratios. |
| 2 | Clip-mode text (`7 Tr` + `sh`) never paints. | Node render with `useSystemFonts: true` versus `false`. | pdf.js defaults `useSystemFonts` to `!isNodeJS` (`pdf.mjs:15463`). The worker then skips standard font data (`pdf.worker.mjs:34366`), and the canvas builds clip glyph paths only when `!font.missingFile` (`pdf.mjs:12127`). |
| 3 | Pages 2 and 3 lose every text colour, which falls back to `#111827`. | Inspector swatch shows `#111827`. | `zipPdfTextItemPaints` matches by count only. pdf.js splits each Courier line into about 5 items (26 shows against 34 items), and a mode-7 paint is `null`. |
| 4 | Edited rotated text exports horizontal. Hit-testing and selection are unrotated. Stretch is lost. | Export wrote `1 0 0 1 385.2756 270 Tm`. | `drawDirtyPdfTextInk` in `lib/pdf/export-pdf.ts`; `hitTestPdfText` in `lib/editor/object-utils.ts`. |
| 5 | Vector edits drop dash, even-odd and miter limit. | A moved `[6 4]` line previews solid. | `setDash` and `setMiterLimit` are untracked. Export only emits `f`/`B`. |
| 6 | Moved or deleted vectors are painted over in white, not removed. | Export stream. | `paintPdfVectorCoverPath` |
| 7 | Search can't match across pdf.js items. | "Courier: The quick" returns no matches. | `lib/ocr/search.ts` |
| 8 | Export drops Info (Title, Author, Subject) and adds an empty `/AcroForm`. | Export object stream. | `PDFDocument.create()`; `source.getForm()` |
| 9 | Vector hit-testing uses the bounding box for every non-line path. | Hovering inside the spirograph picks its outer box. | `hitTestVectorCommands` |

Fix plan: one PR per row group, in the order 1, 2, 3, 4 (with #10–11 from the plan), 5 + 6 + 9, 8, then 7. Delete this note once they have shipped.
