# Keep last page; fix silent delete no-op

Why Delete refused the final page without feedback, and how the sidebar surfaces the one-page minimum.

Primary sources: page sidebar, editor store `setPages`, export gate.

---

## Silent guard

[`components/editor/page-sidebar.tsx`](../../components/editor/page-sidebar.tsx) filters out `currentPageId`, then returns early when `next.length === 0` instead of calling `setPages`. With three pages, the first two deletes succeed; the last remaining page no-ops with no UI change.

The policy (keep ≥1 page) is intentional. The bug is missing feedback — the button stayed enabled and appeared broken.

---

## Why keep at least one page

- No “add blank page” flow; an empty document is a dead end except Undo or Open PDF
- [`lib/pdf/run-export.ts`](../../lib/pdf/run-export.ts) rejects `pages.length === 0` (“Open a PDF before exporting”)
- Matches common PDF editor behavior (Acrobat, Preview, etc.)

[`editorStore.setPages`](../../lib/editor/store.ts) can set `currentPageId` to `null` for an empty list (`pages[0]?.id ?? null`), and the sidebar/viewport already render empty states — but product policy chooses not to enter that state via Delete.

---

## Fix

Same disabled + tip pattern as Undo / Zoom in [`editor-toolbar.tsx`](../../components/editor/editor-toolbar.tsx):

- `canDeletePage = pages.length > 1`
- Delete wrapped in `ToolbarTip`: `"Delete current page"` vs `"Can't delete the last page"`
- `disabled={!canDeletePage}`
- Keep the `next.length === 0` early return as defense in depth; never call `setPages([])` from Delete
