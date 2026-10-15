# Paperoo Editor

A browser PDF editor that lets users change text, images, and vectors already on a PDF page, and add new overlay content on top.

## PDF content edits

**Run**: A single piece of text that already exists in the PDF, as the PDF viewer reports it (one stretch of glyphs sharing font and position, not a word or paragraph). _Avoid_: Text item, span, line, paragraph

**Dirty run**: A run whose text or style now differs from what the PDF originally contained. _Avoid_: Edited item, modified text

**Replacement**: The text drawn in place of a dirty run, in the run's position. _Avoid_: Overlay text (that is user-added content), redraw

**Original ink**: The glyphs of a run as the source PDF paints them. _Avoid_: Canvas text, old text

**Removal**: Taking a dirty run's original ink out of the page itself, so nothing underneath needs hiding. _Avoid_: Delete, erase, redaction

**Cover**: A patch painted over original ink to hide it when removal is not possible. _Avoid_: Mask, white box, whiteout
