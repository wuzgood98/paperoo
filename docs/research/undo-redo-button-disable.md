# Disable Undo/Redo when history is empty

How the editor knows whether undo/redo is available, why toolbar buttons stayed enabled, and how to subscribe reactively without putting history into `EditorStoreState`.

Primary sources: paperoo editor store, history helpers, and toolbar.

---

## Current APIs

[`lib/editor/history.ts`](../../lib/editor/history.ts) keeps two stacks:

- `past` — snapshots before recorded edits
- `future` — snapshots after undo

`undoHistory` / `redoHistory` return `null` when the corresponding stack is empty.

[`lib/editor/store.ts`](../../lib/editor/store.ts) already exposes imperative flags:

- `canUndo: () => internal.history.past.length > 0`
- `canRedo: () => internal.history.future.length > 0`

`undo` / `redo` call the history helpers and no-op when they return `null`.

---

## Reactivity gap

History lives on `StoreInternal`, not `EditorStoreState`. `useEditorStore` selects only from `internal.state` via `useSyncExternalStore`.

The toolbar previously selected `fileName` / `status` / `zoom` / `isExporting` and gated Undo/Redo with `disabled={!ready}` only ([`components/editor/editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx)). None of those slices flip when `past`/`future` length changes after an edit or a full undo, so calling `editorStore.canUndo()` during render without a history-aware snapshot leaves buttons stale.

Hotkeys in [`components/editor/editor-hotkeys.tsx`](../../components/editor/editor-hotkeys.tsx) call `undo()`/`redo()` directly; empty stacks already no-op — no UI gating required there.

---

## Fix

Subscribe to the boolean snapshots with dedicated hooks next to `useEditorStore`:

```ts
useSyncExternalStore(
  editorStore.subscribe,
  editorStore.canUndo,
  editorStore.canUndo
);
useSyncExternalStore(
  editorStore.subscribe,
  editorStore.canRedo,
  editorStore.canRedo
);
```

Any `emit()` after history push/undo/redo re-runs the snapshot; React re-renders only when the boolean changes. Toolbar then uses `disabled={!ready || !canUndo}` / `!canRedo`.

This avoids duplicating flags into `EditorStoreState` that could drift from `internal.history`.
