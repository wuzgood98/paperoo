# Mobile responsiveness for the Paperoo editor

How the editor chrome is laid out today, which WCAG and platform rules apply, and what to change so a phone can use the app.

Primary sources: paperoo editor shell / toolbar / overlay, [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Understanding 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow), [Understanding 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [MDN `env()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env), [MDN viewport meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), [MDN CSS values and units](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Values_and_units), Next.js `generateViewport` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md`).

---

## Current layout

[`components/editor/editor-shell.tsx`](../../components/editor/editor-shell.tsx) is a full-height column (`h-svh`, `overflow-hidden`) with a 48px toolbar and a three-column grid:

```
grid-cols-[220px_minmax(0,1fr)_56px]
```

On a 390 CSS-pixel phone that leaves about 114px for the PDF. At 320px the center column is about 44px. There is no `md`/`lg` collapse of the sidebar or tool rail. The only editor breakpoint is hiding the filename below `sm` in [`editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx).

The toolbar is a single non-wrapping `h-12` row. Search is `min-w-40`. The shell clips overflow, so controls disappear instead of wrapping.

[`editor-overlay.tsx`](../../components/editor/editor-overlay.tsx) paints `absolute inset-0 touch-none` over every page, so a finger never reaches the scroller.

[`app/layout.tsx`](../../app/layout.tsx) has no `viewport` export. Next.js still emits `width=device-width, initial-scale=1`. There is no `viewport-fit=cover`, so [`env(safe-area-inset-*)`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env) is `0px`. Toasts sit at `bottom-(--toast-inset)` with no home-indicator padding.

Dialogs already become bottom sheets under `sm` ([`dialog.tsx`](../../components/ui/dialog.tsx) `bottomStickOnMobile`). Inputs already use `text-base` below `sm` ([`input.tsx`](../../components/ui/input.tsx)), which is the 16px floor that stops iOS from zooming on focus.

`.editor-pressable:active` lives inside `@media (hover: hover) and (pointer: fine)` in [`globals.css`](../../app/globals.css), so touch gets no press scale.

---

## Rules that apply

### Reflow (WCAG 2.2 1.4.10)

At 320 CSS pixels, content must stay available without two-dimensional scrolling, except parts that need a 2D layout. Note 2 of the criterion names “interfaces where it is necessary to keep toolbars in view while manipulating content” — the **page canvas** may pan in two axes. The **chrome around it** (toolbar, page list, tools, inspector) must still be reachable without the _page_ scrolling sideways.

### Dragging (WCAG 2.2 2.5.7)

Page reorder is HTML5 drag-and-drop only ([`page-sidebar.tsx`](../../components/editor/page-sidebar.tsx)). The criterion requires a single-pointer alternative. Move up / move down via `editorStore.setPages` satisfies that, and is the only reorder that works in a phone sheet.

### Target size (WCAG 2.2 2.5.8)

Targets must be at least 24×24 CSS pixels (or spaced so 24px-diameter circles do not intersect). Editor buttons already grow a 44px (`min-h-11`) hit slop on `pointer-coarse`. Keep that; do not shrink it.

### Viewport height

[`svh` is the small viewport](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Values_and_units) (URL bar visible). `dvh` tracks the current visible height and would resize the shell when chrome shows or hides, which retriggers fit zoom. Keep `h-svh`.

### Safe areas

[`viewport-fit=cover`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport) lets the page paint under the notch. Then pad chrome with `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`. Next.js types this as `viewportFit` on `Viewport` (`node_modules/next/dist/lib/metadata/types/extra-types.d.ts`). Do not set `maximumScale` or `userScalable: false`.

---

## Target layout below `md` (768px)

Desktop (`md` and up) stays the three-column grid.

Below `md`:

1. **Pages** — hide the 220px column. A Pages control opens the same list in `Dialog` (already a sheet on small screens).
2. **Tools** — the existing rail becomes a horizontal row under the canvas (`overflow-x-auto`, `touch-action: pan-x`). Shape menu opens `side="top"`.
3. **Top bar** — logo, truncated filename, open, undo, redo, search icon, More (Fit, Width, Print, OCR regions, Export).
4. **Inspector** — stays above the page; strip may scroll sideways; wide fields cap at `max-w-full`.
5. **Select tool** — drop `touch-none` so the scroller receives pan gestures. Keep `touch-none` for draw, highlight, shape, and signature placement.
6. **Toasts** — raise `bottom` by the tool-row height plus `env(safe-area-inset-bottom)`.

Fit zoom already follows the scroller `ResizeObserver` in [`editor-viewport.tsx`](../../components/editor/editor-viewport.tsx). Leave the 32px padding in [`coordinates.ts`](../../lib/editor/coordinates.ts).

Out of scope: pinch-zoom, a PWA manifest, and changing how objects drag once a pointer is down.
