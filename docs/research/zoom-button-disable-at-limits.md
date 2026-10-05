# Zoom button disable at limits + Fit/Width pressed state

How Zoom In/Out know they are at the clamp boundary, and how Fit/Width show the active `zoomMode` with the same Toggle pattern as the tool rail.

Primary sources: paperoo editor store, types, toolbar, and Toggle UI.

---

## Zoom limits

[`lib/editor/types.ts`](../../lib/editor/types.ts):

- `MIN_ZOOM = 0.1`
- `MAX_ZOOM = 8`
- `ZOOM_STEP = 0.25`

[`lib/editor/store.ts`](../../lib/editor/store.ts) `setZoom` clamps with `clamp(zoom, MIN_ZOOM, MAX_ZOOM)`; `zoomBy` adds a delta then clamps. Further steps at the boundary leave `zoom` unchanged.

`zoom` lives on `EditorStoreState`, so [`useEditorStore`](../../lib/editor/store.ts) already re-renders the toolbar when it changes — no dedicated hooks (unlike undo/redo history, which sits outside state).

Toolbar gates:

- Zoom out: `disabled={!ready || zoom <= MIN_ZOOM}`
- Zoom in: `disabled={!ready || zoom >= MAX_ZOOM}`

Hotkeys still call `zoomBy` and rely on clamp.

---

## Fit / Width mode

`ZoomMode` is `"custom" | "fit-page" | "fit-width"`. `fitPage` / `fitWidth` set mode then `recomputeFitZoom`. Manual zoom (`zoomBy`, pinch) switches to `"custom"`.

`Button` only uses `data-pressed` for momentary click feedback ([`button-variants.ts`](../../components/ui/button-variants.ts)). Sticky mode UI uses [`Toggle`](../../components/ui/toggle.tsx) with Base UI `data-pressed` styles — same as the tool rail ([`tool-rail.tsx`](../../components/editor/tool-rail.tsx)):

```ts
pressed={tool === item.id}
onPressedChange={() => editorStore.setTool(item.id)}
```

Fit/Width follow that pattern with `pressed={zoomMode === "fit-page"|"fit-width"}` and `onPressedChange` always calling `fitPage`/`fitWidth`, so the active control stays pressed and clickable.
