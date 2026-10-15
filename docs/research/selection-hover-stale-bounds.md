# Selection hover stale bounds

Why the hover/selection border lands on the wrong PDF object after an earlier click (e.g. clicking the background to clear selection) followed by a scroll or zoom.

Primary sources: paperoo editor overlay source ([`overlay-gestures.ts`](../../components/editor/overlay-gestures.ts), [`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx), the PDF layers), [MDN `Element.getBoundingClientRect()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) (rect is relative to the viewport, so it changes whenever the element scrolls).

---

## Symptom

1. Select tool. Click anywhere on a page (background, text, image…).
2. Scroll the viewport (or change zoom).
3. Hover a link or text run: the hover border appears on a different object, offset by the scroll distance. Clicking selects that wrong object.
4. Before the first click on a page everything lines up.

## Cause — the pointerdown bounds snapshot is never released

- `toPage` converts `clientX/clientY` to page points with `screenToPage(point, bounds, zoom)`, where `bounds` was `boundsRef.current ?? snapshotBounds(root)`.
- `boundsRef` is written on every pointerdown: the overlay root (`editor-overlay.tsx` `onPointerDown`) and `pdf-image-layer`, `pdf-vector-layer`, `pdf-annotation-layer`, `overlay-object`.
- Nothing ever set it back to `null`. `onPointerUp`, `onPointerCancel` and `finishGesture` cleared only `gestureRef`.
- So after the first click, hover (`pdfHoverIdsAtPoint` in `onPointerMove`), click hit-tests, double-click edit and OCR drag-select all used the click-time rect. `getBoundingClientRect` is viewport-relative, so once the page scrolls the stale `top/left` shift every computed page point by the scroll delta.
- Clicking an inactive page makes it worse: page activation can scroll the stack immediately after the snapshot (see [text-edit-scroll-jump.md](text-edit-scroll-jump.md)).

The snapshot exists to keep a drag/resize/rotate stable; it is only valid while that gesture is in flight.

## Fix

- `toPage` uses `boundsRef.current` only while `gestureRef.current` is set; otherwise it takes a fresh `snapshotBounds(root)`.
- `boundsRef.current = null` when a gesture ends: `finishGesture`, the `rect` branch of `onPointerUp`, and the overlay's `onPointerCancel`.
- Layers are unchanged: they still snapshot right before starting a gesture.
