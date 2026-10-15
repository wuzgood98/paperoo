# Undo / Redo keyboard shortcuts

Why ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Shift+Z and ⌘Y / Ctrl+Y looked broken in Paperoo's editor, and the fixes.

Primary sources: paperoo hotkeys / store / inspector modules, `@base-ui/react` 1.8.0 Slider source in `node_modules`, [MDN `KeyboardEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key), [W3C UI Events KeyboardEvent key values](https://w3c.github.io/uievents-key/). Reproduced in the dev server with a one-page PDF.

---

## Summary

There are two independent bugs. Neither is in the history stack.

1. **Ctrl/⌘+Shift+Z ran undo, not redo.** The undo binding didn't constrain Shift, so it matched the Shift chord too. It comes first in the list, and `bindHotkeys` stops at the first match. This dates back to the initial commit.
2. **Ctrl/⌘+Z and Y did nothing right after using a slider.** Base UI's Slider moves focus to a hidden `<input type="range">`. The hotkey guard treated every `INPUT` as a typing target and returned early, so the shortcut was dropped. A range input has no native undo, so nothing happened at all.

Plain Ctrl+Z and Ctrl+Y worked when focus was on the body or a button.

---

## How undo/redo is wired

- **History stacks.** [`lib/editor/history.ts`](../../lib/editor/history.ts) has `pushHistory`, `undoHistory` and `redoHistory`, capped at 80 entries.
- **Store.** [`lib/editor/store.ts`](../../lib/editor/store.ts):
  - `commit()` snapshots before each recorded edit.
  - `undo` / `redo` apply a snapshot and `emit()`.
  - `canUndo` / `canRedo` are exposed through the `useCanUndo` / `useCanRedo` hooks.
- **Toolbar buttons.** [`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx) calls `editorStore.undo()` / `redo()` directly. The tooltips show `⌘Z` / `⇧⌘Z`.
- **Shortcuts.** [`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) registers `{ key: "z", meta: true }` → undo, `{ key: "z", meta: true, shift: true }` → redo, and `{ key: "y", meta: true }` → redo.
- **Mounting.** `EditorHotkeys` is mounted unconditionally in [`components/editor/editor-shell.tsx`](../../components/editor/editor-shell.tsx). It binds in a `useEffect` with `[]` deps. There's no stale closure, because the handlers call the module-level `editorStore`.
- **Dispatcher.** [`lib/hotkeys.ts`](../../lib/hotkeys.ts) has one bubble-phase `window` `keydown` listener:
  - `matches()` compares `event.key.toLowerCase()`.
  - "meta" means `metaKey || ctrlKey`.
  - Shift is only checked when `hotkey.shift` is set to `true` or `false`.
  - The first match wins.
- **README.** [`README.md`](../../README.md) documents Redo as `⇧⌘Z / Ctrl+Shift+Z` or `⌘Y / Ctrl+Y`.

---

## Root cause 1: the undo binding also matched the Shift chord

```ts
// components/editor/editor-hotkeys.tsx (before)
{ handler: () => editorStore.undo(), key: "z", meta: true },
{ handler: () => editorStore.redo(), key: "z", meta: true, shift: true },
```

```ts
// lib/hotkeys.ts matches()
if (hotkey.shift === true && !event.shiftKey) {
  return false;
}
if (hotkey.shift === false && event.shiftKey) {
  return false;
}
```

With Shift held on a Latin layout, `key` is `"Z"`. `key` reflects the character produced with the current modifiers ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key), [UI Events key](https://w3c.github.io/uievents-key/)). `matches()` lowercases it, so the key check passed for both entries. The undo entry had `shift: undefined`, so neither Shift check ran and it matched first. The dispatcher called `preventDefault()`, ran undo and returned. The redo entry was never reached.

**Repro:** rotate a page, press Ctrl+Y to get a redo entry, then press Ctrl+Shift+Z. The page unrotated, because Paperoo undid instead of redoing.

The PageUp/PageDown bindings already guard against this with `shift: false` ([`page-up-down-hotkeys.md`](./page-up-down-hotkeys.md)).

## Root cause 2: the focus guard treated non-text inputs as typing targets

```ts
// lib/hotkeys.ts (before)
const isInputElement = (target) => { ... return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"; };
...
if (isInputElement(event.target) && !hotkey.allowInInput) { return; }
```

Base UI Slider focuses the thumb's input when you press the control. `focusThumb` calls `input.focus()` (`node_modules/@base-ui/react/slider/control/SliderControl.js`), and that input is `type: 'range'` (`slider/thumb/SliderThumb.js`).

These sliders put focus there:

- Opacity in [`inspector-bar.tsx`](../../components/editor/inspector-bar.tsx)
- Lightness in [`color-field.tsx`](../../components/editor/color-field.tsx)
- [`pdf-annotation-inspector.tsx`](../../components/editor/pdf-annotation-inspector.tsx)

**Repro:** add a text box and click the Opacity slider. `document.activeElement` is a range `INPUT`. Ctrl+Z changed nothing, and Redo stayed disabled.

Real text fields (e.g. font size, `<Input type="number">`) intentionally keep the browser's own field undo. The comment at the top of `lib/hotkeys.ts` says this is deliberate.

---

## Ruled out

| Candidate | Evidence |
| --- | --- |
| Listener not mounted | Mounted in `editor-shell.tsx`. Synthetic Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and Meta+Z on `body` came back `defaultPrevented === true`. |
| Shift / Caps Lock make `key` `"Z"` | Handled by `toLowerCase()`. |
| Mac vs Windows modifier | `metaKey \|\| ctrlKey`. |
| Another handler cancelling first | No capture-phase keydown listeners. React `onKeyDown` handlers only handle Enter/Escape on their own inputs. |
| Stale closure | Handlers call module-level `editorStore`. |
| History never pushed | The toolbar buttons work, and plain Ctrl+Z undoes. |
| Browser undo in contenteditable | Only while editing a text overlay. This is intended. |

---

## Fix

1. `editor-hotkeys.tsx`: the undo binding now sets `shift: false`.
2. `lib/hotkeys.ts`: the guard is split in two.
   - **Text-entry targets** (contenteditable, `TEXTAREA`, text-like `INPUT` types): every hotkey is skipped unless `allowInInput` is set. This is unchanged.
   - **Other form controls** (range, color, checkbox, radio, file, button inputs, and `SELECT`): only _unmodified_ hotkeys are skipped, because arrows, Delete, Backspace, Escape and PageUp/Down drive those controls. `meta` hotkeys go through, since these controls have no native ⌘Z / ⌘Y / ⌘= / ⌘- / ⌘O behaviour.
3. `test/hotkeys.test.ts` covers chord matching and the guard.

## Follow-up: one undo step per slider drag

With Ctrl+Z reaching the sliders, a second problem showed up. The opacity, lightness and highlight-opacity sliders called `patchSelected` / `patchPdfAnnotation` on every `onValueChange`, so one drag pushed one history entry per step.

- `editorStore.previewEdit(edit)` runs `edit` without recording history. The first preview saves the pre-drag snapshot.
- `editorStore.commitPreview()` pushes that saved snapshot once, from Base UI's `onValueCommitted`. Base UI fires it on pointer release and after each keyboard step. A drag that ends where it started records nothing.
- If `onValueCommitted` never arrives, the pending drag still becomes its own step on the next recorded edit or on undo/redo. `resetDocument` / `clearDocument` drop it.
- `test/slider-preview-history.test.ts` covers the store behaviour.
