# Editor runtime research

Primary-source investigation for the Paperoo PDF editor (upload → render pages → manipulate an overlay of editor objects → export). Desktop-first, pointer-events based.

**Research date:** 2026-09-25 **Verified against:** `next@16.3.4`, `react@19.2.8`, `react-dom@19.2.8`, `@types/react@19.3.0`, `@base-ui/react@1.8.0`, `oxlint@1.85.0` / `ultracite@7.12.0`, Node `v24.15.0`.

Every claim below is tagged with its source: a file path inside this repo, a file path inside a package installed in a scratch directory (`%TEMP%\Paperoo-research`, outside the repo), a bundled Next doc under `node_modules/next/dist/docs/`, or a URL. Anything not verified is called out explicitly under **Not verified**.

---

## A. Keyboard shortcuts — `@tanstack/react-hotkeys`

Inspected version **0.12.0** (published 2026-09-24), which depends on core `@tanstack/hotkeys@0.10.0`. Installed in the scratch dir; the package ships no `src/` in 0.12.0, so the notes below come from the shipped `dist/*.js` and `dist/*.d.ts`.

### A1. Actual public API

**Provider is optional.** `HotkeysProvider` only carries default options; the context defaults to `null` and every consumer falls back to `{}`. Hotkeys work with no provider mounted at all.

```js
// react-hotkeys/dist/HotkeysProvider.js
const HotkeysContext = createContext(null);
function HotkeysProvider({ children, defaultOptions = DEFAULT_OPTIONS }) {
  /* ... */
}
function useDefaultHotkeysOptions() {
  return useContext(HotkeysContext)?.defaultOptions ?? {};
}
```

Actual event wiring is a module-level singleton (`getHotkeyManager()`), not the provider — one listener per target regardless of how many hooks are mounted (`@tanstack/hotkeys/dist/hotkey-manager.d.ts`, class `HotkeyManager`, `static getInstance()`).

**Exported surface** (`react-hotkeys/dist/index.d.ts`), which also re-exports the whole core package via `export * from "@tanstack/hotkeys"`:

`HotkeysProvider`, `useHotkey`, `useHotkeys`, `useHotkeySequence`, `useHotkeySequences`, `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, `useHotkeyRecorder`, `useHotkeySequenceRecorder`, `useHotkeyRegistrations`, `useHotkeyHint`, `useHotkeysContext`, `useDefaultHotkeysOptions`.

**Primary signatures:**

```ts
// react-hotkeys/dist/useHotkey.d.ts
export declare function useHotkey(
  hotkey: RegisterableHotkey,
  callback: HotkeyCallback,
  options?: UseHotkeyOptions
): void;

export interface UseHotkeyOptions extends Omit<HotkeyOptions, "target"> {
  target?:
    | React.RefObject<HTMLElement | null>
    | HTMLElement
    | Document
    | Window
    | null;
}
```

```ts
// react-hotkeys/dist/useHotkeys.d.ts
export interface UseHotkeyDefinition {
  hotkey: RegisterableHotkey;
  callback: HotkeyCallback;
  options?: UseHotkeyOptions;
}
export declare function useHotkeys(
  hotkeys: Array<UseHotkeyDefinition>,
  commonOptions?: UseHotkeyOptions
): void;
```

`useHotkeys` takes a runtime array, so a variable-length shortcut list is a single hook call and does not violate the rules of hooks (documented in the same `.d.ts`).

**How a shortcut is declared** — either a typed template string or an object (`@tanstack/hotkeys/dist/hotkey.types.d.ts`):

```ts
type Hotkey =
  | Key
  | SingleModifierHotkey
  | TwoModifierHotkey
  | ThreeModifierHotkey
  | FourModifierHotkey;
type RegisterableHotkey = Hotkey | RawHotkey;

useHotkey("Mod+Shift+S", handler); // template string
useHotkey({ key: "S", mod: true }, handler); // logical key + modifier flags
useHotkey({ code: "KeyW", mod: true }, handler); // physical code (layout-independent)
```

Canonical modifier names are `Control`, `Alt`, `Shift`, `Meta` — not `Ctrl`/`Cmd`/`Option`.

**Cmd vs Ctrl.** The `Mod` modifier is platform-adaptive and resolved at registration time:

> "**macOS**: `Mod` → `Meta` (Command key ⌘); **Windows/Linux**: `Mod` → `Control` (Ctrl key)" — `@tanstack/hotkeys/dist/hotkey.types.d.ts`

```js
// react-hotkeys/dist/useHotkey.js
const platform = mergedOptions.platform ?? detectPlatform();
const hotkeyString = normalizeRegisterableHotkey(hotkey, platform);
```

`Mod+Control` and `Mod+Meta` are deliberately excluded from the type union because they would duplicate a modifier on one platform. `platform?: 'mac' | 'windows' | 'linux'` can force it.

**Scopes: there is no named-scope system.** I grepped the entire core `dist/` for `scope`; the only `scope` option is `HotkeyConflictOptions.scope?: 'overlapping' | 'all'` in `conflicts.d.ts`, which is a conflict-_query_ filter, not a runtime activation scope. Scoping is done with two things only:

- `target` — a React ref, element, `Document`, or `Window`. Resolved in an effect, defaulting to `document`.
- `enabled` — a soft-disable that keeps the registration alive and only suppresses the callback.

```js
// react-hotkeys/dist/useHotkey.js — target resolution
const resolvedTarget = isRef(optionsRef.current.target)
  ? optionsRef.current.target.current
  : (optionsRef.current.target ??
    (typeof document !== "undefined" ? document : null));
```

**Sequences** (Vim-style `g` then `i`) are a separate manager: `useHotkeySequence`, `useHotkeySequences`, `getSequenceManager()`, `DEFAULT_SEQUENCE_TIMEOUT` (`@tanstack/hotkeys/dist/sequence-manager.d.ts`).

**Full option set and defaults** (`@tanstack/hotkeys/dist/hotkey-manager.d.ts` and `dist/_registration.js`):

```js
const defaultHotkeyOptions = {
  preventDefault: true,
  stopPropagation: true,
  eventType: "keydown",
  enabled: true,
  ignoreInputs: true,
  conflictBehavior: "warn",
};
```

Note `preventDefault` and `stopPropagation` are **both `true` by default** — more aggressive than most libraries, and it will swallow events that other parts of the editor may want.

`conflictBehavior` is `'warn' | 'error' | 'replace' | 'allow'`; registering the same hotkey twice on the same target logs a `console.warn` by default (`dist/_registration.js`, `handleConflict`).

### A2. Events from inputs / textareas / contenteditable — **the critical finding**

The detection itself is good. `@tanstack/hotkeys/dist/_event-target.js`:

```js
function isInputElement(element) {
  if (!element) return false;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "button" || type === "submit" || type === "reset")
      return false;
    return true;
  }
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )
    return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return false;
}
```

`shouldIgnoreInputEvent` is thorough — it checks the listener root's `activeElement`, the event's `composedPath()` (so shadow DOM works), and finally `event.target`.

**But the default is computed per-hotkey, and it is the wrong default for this editor:**

```js
// @tanstack/hotkeys/dist/_registration.js
function getDefaultIgnoreInputs(parsedHotkey) {
  if (parsedHotkey.ctrl || parsedHotkey.meta) return false;
  if (parsedHotkey.key === "Escape" || parsedHotkey.code === "Escape")
    return false;
  return true;
}
```

Consequences for Paperoo's inline text editing:

| Shortcut | Default `ignoreInputs` | Behaviour while typing in a text object |
| --- | --- | --- |
| `Delete` / `Backspace` (delete object) | `true` | Correctly ignored |
| `Mod+Z` / `Mod+Shift+Z` (undo/redo) | **`false`** | **Fires — undoes an editor object while the user is typing** |
| `Mod+A` (select all objects) | **`false`** | **Fires — hijacks select-all-text** |
| `Mod+D`, `Mod+C`, `Mod+V` (duplicate/copy/paste) | **`false`** | **Fires inside the text box** |
| `Escape` | `false` | Fires (usually desirable — exit edit mode) |

The reasoning is defensible in general (you _do_ want `Mod+S` to save from inside a form field), but for a canvas editor with inline text editing it is backwards for every destructive `Mod+` shortcut. Every such registration must explicitly pass `ignoreInputs: true`. That is easy to forget and there is no lint rule for it.

Related open bug: **#132 "ignoreInput isn't detected across realms"** (i.e. it fails for same-origin iframes / separate documents).

### A3. SSR, Next 16, React 19, bundle size

**SSR-safe, but client-only in practice.** All DOM access happens inside `useEffect`, and target resolution guards `typeof document !== 'undefined'` (`useHotkey.js`, quoted above). There is no module-level DOM access. Any component calling these hooks still needs `'use client'` because they use `useEffect`/`useRef` — that is a React constraint, not a library limitation.

**React 19 compatible.** `peerDependencies: { react: ">=16.8", react-dom: ">=16.8" }` and it is developed against `react@^19.3.0` (`react-hotkeys/package.json` devDependencies). It uses only `useEffect`/`useRef`/`createContext`/`useContext`/`useMemo`.

One pattern worth flagging: `useHotkey` writes to refs **during render** and runs an effect with **no dependency array** on every render:

```js
// react-hotkeys/dist/useHotkey.js
callbackRef.current = callback; // ref write during render
optionsRef.current = mergedOptions;
managerRef.current = manager;
useEffect(() => {
  /* register / re-target */
}); // no dep array
useEffect(() => {
  /* sync callback + options */
}); // no dep array
```

Ref writes during render are not safe under concurrent rendering in the general case, and two dependency-array-less effects run on _every_ render of _every_ component using a hotkey. It works, but it is not idiomatic React 19 and it is the kind of thing React Compiler / StrictMode surfaces.

**Module format — breaking change in 0.12.0.** 0.11.0 shipped dual CJS+ESM and included `src/`. 0.12.0 is **ESM-only** and ships `dist` only:

```jsonc
// 0.12.0 package.json
"type": "module",
"types": "./dist/index.d.ts",
"exports": { ".": "./dist/index.js", "./package.json": "./package.json" },
"engines": { "node": ">=20" },
"files": ["dist"]
```

(0.11.0 had `"main": "./dist/index.cjs"`, a `require` condition, and `"types": "./dist/index.d.cts"`.) ESM-only is fine for Next 16 + Turbopack, but it is a silent breaking change in a patch-looking minor bump.

**Bundle size — measured, not estimated.** Bundled `useHotkey` + `useHotkeys` with esbuild (`--bundle --minify --format=esm --external:react`) in the scratch dir. This pulls in `@tanstack/hotkeys` core and `@tanstack/react-store`:

| Metric          | Size                  |
| --------------- | --------------------- |
| Minified        | 19,319 B (≈18.9 KB)   |
| Minified + gzip | **7,181 B (≈7.0 KB)** |

Raw unminified `dist/*.js` totals for reference: react adapter 28.5 KB, core 108.4 KB, store 12.1 KB. The core is large because it ships key-name tables, display-label/formatting helpers, a recorder, a sequence manager, and a conflict detector — most of which a PDF editor will not use. Tree-shaking does cut it down substantially (108 KB → the 7 KB gzip figure above), but ~7 KB gzip is still real weight for "handle about 15 shortcuts".

### A4. Maturity and recommendation

**Version history** (`npm view @tanstack/react-hotkeys time`): first publish `0.0.1` on 2026-02-10; **29 releases in ~7.5 months**; `0.11.0` on 2026-09-21 and `0.12.0` on 2026-09-24 — two releases three days apart, the latest one published the day before this research.

**Repo signals** (`gh api repos/TanStack/hotkeys`): 727 stars, created 2026-01-21, 23 open issues, not archived.

**The README's own words:**

> "TanStack Hotkeys is alpha. We are actively developing the library and are open to feedback and contributions." — `@tanstack/react-hotkeys/README.md`

**Open issues on _core matching behaviour_** (`gh issue list --repo TanStack/hotkeys --state open`) — these are not cosmetic:

- **#138** — Global single-key hotkeys fire while a focused ARIA composite widget (tabs / menu / listbox / grid) already owns the key. Paperoo has a Base UI `Toolbar`, `Menu`, `Select` and `Tabs` in the shell; this directly affects it.
- **#142** — `Space` shortcut overrides native behaviour, triggering focused elements. `Space` is the natural "pan/hand tool" modifier in a canvas editor.
- **#132** — `ignoreInputs` isn't detected across realms.
- **#143** — `useKeyHold` / `KeyStateTracker` latches a modifier forever when a `keyup` is swallowed without a `blur` (e.g. macOS `Cmd+Shift+4`). A latched modifier means `Mod+`-gated behaviour stays stuck on.
- **#116** — `useHotkey` callbacks fire during active `useHotkeySequence` matching.

**Documentation:** the hosted docs at <https://tanstack.com/hotkeys> are referenced from the README, but the package itself ships no prose docs — the JSDoc in the `.d.ts` files is the practical reference, and it is genuinely good (every option has a comment, with examples).

#### Recommendation: **do not adopt for v1. Write a small in-repo keydown handler.**

Reasoning, weighted for this specific product:

1. **The default that matters most is wrong for us.** `Mod+Z` firing inside a focused textarea is precisely the bug the brief calls out as unacceptable, and it is the _default_. We would be fighting the library's opinion on every destructive shortcut.
2. **Two open issues (#138, #142) are exactly our UI.** A toolbar-and-menu-heavy canvas app with a `Space` pan modifier is the shape of app those bugs are filed against.
3. **Self-declared alpha with high churn**, including an undeclared ESM-only break between 0.11 and 0.12. Pinning is mandatory, and upgrades need manual re-verification.
4. **We need maybe 15 shortcuts**, all flat combos. We need none of the library's differentiators: sequences, the recorder UI, cheatsheet formatting, conflict detection, devtools.
5. **~7 KB gzip** for a `switch` statement we can write in ~60 lines.

The parts worth copying rather than depending on — they are the genuinely non-obvious bits:

- The `isInputElement` predicate, including the `button`/`submit`/`reset` carve-out and the `composedPath()` check (`_event-target.js`).
- `Mod` normalisation: check `event.metaKey` on macOS and `event.ctrlKey` elsewhere, detected once.
- Reading `event.code` rather than `event.key` for layout-independent bindings, and `event.key` for character bindings.

Sketch of the in-repo version, with the input guard **defaulting to on**:

```ts
// Inverted default vs the library: shortcuts are ignored in text contexts unless opted out.
function isTextEntryTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    return true;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    return t !== "button" && t !== "submit" && t !== "reset";
  }
  return false;
}
```

Revisit `@tanstack/react-hotkeys` at 1.0, or earlier if we need a user-customisable shortcut recorder — that is the one feature where rebuilding is genuinely more expensive than adopting.

**Not verified:** hosted docs at tanstack.com/hotkeys were not fetched (README link only); the library was not executed in a browser; issue _content_ beyond titles was not read.

---

## B. React 19.2 + Next 16 specifics

### B1. React 19.2 APIs — availability confirmed from the installed package

Enumerated at runtime from the repo's own install:

```console
$ node -p "require('react').version"
19.2.8
$ node -e "console.log(Object.keys(require('react')).join('\n'))"
```

Relevant exports present, **all unprefixed** (no `unstable_`/`experimental_`):

`Activity`, `useEffectEvent`, `useOptimistic`, `useTransition`, `useDeferredValue`, `useSyncExternalStore`, `use`, `useActionState`, `cache`, `cacheSignal`, `startTransition`, `forwardRef` (still exported, no longer needed).

Type signatures from `node_modules/@types/react/index.d.ts` (`@types/react@19.3.0`):

```ts
/** @version 19.2.0 */
export function useEffectEvent<T extends Function>(callback: T): T; // line 1798

export interface ActivityProps {
  mode?: "hidden" | "visible" | undefined; // @default "visible"
  name?: string | undefined; // for React DevTools
  children: ReactNode;
}
/** @version 19.2.0 */
export const Activity: ExoticComponent<ActivityProps>; // line 2022

export function useDeferredValue<T>(value: T, initialValue?: T): T; // line 1868
export function useSyncExternalStore<Snapshot>(/* ... */); // line 1931
export function useOptimistic<State>(/* ... */); // line 1937
```

**Ref as prop — `forwardRef` is not needed.** `RefAttributes<T>` now declares `ref` as an ordinary prop (`@types/react/index.d.ts:293-301`):

```ts
interface RefAttributes<T> extends Attributes {
  ref?: Ref<T> | undefined;
}
type Ref<T> = RefCallback<T> | RefObject<T | null> | null; // line 194
```

This matches what the vendored UI components already do — none of `components/ui/*.tsx` uses `forwardRef`.

**Per-API verdict for this editor:**

| API | Available in 19.2.8 | Use it here? |
| --- | --- | --- |
| `useEffectEvent` | Yes, stable, unprefixed | **Yes.** Ideal for pointer handlers that read fresh state (zoom, selection, snap settings) without re-subscribing listeners. |
| `<Activity>` | Yes, stable, unprefixed | **Yes.** Keep off-screen/inactive pages mounted with `mode="hidden"` to preserve scroll/canvas state. Vercel's own guidance endorses exactly this (below). |
| `useSyncExternalStore` | Yes | **Yes.** This is the state answer — see "Decisions". |
| `useDeferredValue` | Yes, with `initialValue` overload | Maybe — for a thumbnail/page-list that lags the live document. |
| `useTransition` | Yes | Maybe — page reorder commits. |
| `useOptimistic` | Yes | **No.** It is designed around Server Actions / async mutations; a local in-memory editor has no pending server state to be optimistic about. |
| `forwardRef` | Exported but unnecessary | **No.** Use `ref` as a prop. |

**Caveat worth knowing: Next ships its own React for the server runtime.** Next 16 states it "uses the latest React Canary release" (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:387`). Confirmed by grepping the vendored copy:

```console
$ rg -o '"19\.[0-9.a-z-]+"' node_modules/next/dist/compiled/react/cjs/react.production.js
19.3.0-canary-cbb046ab-20260731
```

So `next/dist/compiled/react` is a 19.3 canary while the app's own `react` is 19.2.8. Client components resolve the app's copy; both have `Activity` and `useEffectEvent`. The same upgrade guide calls out View Transitions, `useEffectEvent` and `Activity` as the 19.2 highlights.

**Not verified:** I did not test `<Activity mode="hidden">` against a `<canvas>`/`ResizeObserver` at runtime. `Activity` hides via `display: none`, which zeroes an element's layout box — a `ResizeObserver` on a hidden subtree will report `0×0`, so fit-to-width logic must ignore zero-size entries. Flagged as a risk, not a measured result.

### B2. Next 16 App Router — client boundaries and keeping the editor off the server

**`next/dynamic` with `ssr: false` is still supported in the App Router in Next 16**, with one rule: the `dynamic()` call must live in a Client Component.

From `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`:

```jsx
// app/page.js  — note the 'use client' at the top of THIS file
"use client";
import dynamic from "next/dynamic";
const ComponentC = dynamic(() => import("../components/C"), { ssr: false });
```

> "`ssr: false` option will only work for Client Components, move it into Client Components ensure the client code-splitting working properly." — `lazy-loading.md:66`

> "`ssr: false` option is not supported in Server Components. You will see an error if you try to use it in Server Components. `ssr: false` is not allowed with `next/dynamic` in Server Components. Please move it into a Client Component." — `lazy-loading.md:94-95`

I grepped every bundled doc for `ssr: false` and found no deprecation notice anywhere; it also appears as current guidance in `01-app/02-guides/single-page-applications.md:213`, `migrating/from-vite.md`, and `migrating/from-create-react-app.md:387`.

**Recommended structure for Paperoo:**

```
app/editor/page.tsx        Server Component. Renders shell/metadata only.
  └─ components/editor/editor-shell.tsx      'use client' — the boundary
       └─ const EditorCanvas = dynamic(() => import('./editor-canvas'), {
            ssr: false, loading: () => <EditorSkeleton />,
          })
```

`editor-canvas.tsx` then transitively pulls in pdf.js / pdf-lib / the object model, and none of it is reachable from the server graph.

Also from `lazy-loading.md:60`:

> "When a Server Component dynamically imports a Client Component, automatic code splitting is currently **not** supported."

— another reason the `dynamic()` call belongs in the client shell rather than in `page.tsx`.

Two supporting points from the bundled docs:

- Static `import('path')` only: "the path must be explicitly written. It can't be a template string nor a variable" and `dynamic()` "can't be used inside of React rendering" — it must be at module top level (`lazy-loading.md:239`).
- To hard-fence server-only modules from the client graph, use the `server-only` package ("Preventing environment poisoning", `01-app/01-getting-started/05-server-and-client-components.md:528-568`).

Vercel's bundle guidance agrees on the mechanism: `bundle-dynamic-imports` ("Use next/dynamic for heavy components") and `bundle-barrel-imports` ("Import directly, avoid barrel files") — `~/.cursor/skills/vercel-react-best-practices/SKILL.md`. Avoiding barrel files matters here: a `components/editor/index.ts` re-export would drag the whole editor into any chunk that touches it.

### B3. Turbopack + Web Workers — **verified by building, works out of the box**

I built a throwaway Next 16.3.4 app in the scratch dir (`%TEMP%\Paperoo-research\next-worker`) with a worker referenced the standard way, and no `next.config` changes:

```ts
// app/heavy.worker.ts
self.onmessage = (e: MessageEvent<number>) => {
  postMessage(e.data * 2);
};
export {};
```

```tsx
// app/Editor.tsx
"use client";
const w = new Worker(new URL("./heavy.worker.ts", import.meta.url));
```

Result:

```
▲ Next.js 16.3.4 (Turbopack)
✓ Compiled successfully in 9.8s
✓ Generating static pages using 3 workers (3/3)
```

Turbopack emitted a real, compiled worker bootstrap and rewrote the call site to use it:

```console
$ ls .next/static/chunks/turbopack-worker-2ru9m5gbh1na6.js   # 849 B bootstrap
# call site in the app chunk:
e.v(e.r(10914).default("static/chunks/turbopack-worker-2ru9m5gbh1na6.js",
  ["static/chunks/0qmmajg9w8xj8.js","static/chunks/turbopack-2zmlhhefd68sl.js"]))
```

The bootstrap validates it is in a worker context, reads a JSON config from the URL, refuses cross-origin scripts, and `importScripts` the compiled chunks. So: **`new Worker(new URL('./x.worker.ts', import.meta.url))` works with zero configuration in Next 16 + Turbopack, and the TypeScript is compiled.**

Two supporting facts from the bundled docs:

- `turbopackWorkerAssetPrefix` — "Custom asset prefix for Web Worker URLs (entrypoint + module chunks), overriding `assetPrefix`. Mirrors webpack's `output.workerPublicPath`" (`01-app/03-api-reference/08-turbopack.md:413`). First-class worker support, and the knob you need if assets are served from a CDN.
- Magic comments "work with dynamic `import()`, `require()`, `require.resolve()`, and `new Worker()` expressions" — `turbopackIgnore: true`, `turbopackOptional: true` (`08-turbopack.md:130-138`; `lazy-loading.md:177-215`).

**One oddity to be aware of.** Alongside the compiled chunk, the build also emitted the _raw, uncompiled_ TypeScript as a static asset:

```
.next/static/media/heavy.worker.2_fa4l-bg1sme.ts   (89 B — still contains `MessageEvent<number>`)
```

It is registered under a separate module id (`e.q("/_next/static/media/heavy.worker...ts")`) and is **not** what the `new Worker()` call site loads. It appears to be a side effect of `new URL(..., import.meta.url)` also being treated as an asset reference. Harmless for correctness, but it does publish your worker source, and if anything ever loads that URL directly it will fail.

**wasm:** the bundled docs confirm Turbopack has a `wasm` module type (`05-config/01-next-config-js/turbopack.md:296` — "Process as WebAssembly") and that build output carries `wasmAssets` (`07-adapters/09-output-types.md`). Relevant because pdf.js ships an optional wasm build.

**Not verified:** I did not execute the built app in a browser to confirm the worker posts a message back at runtime (an attempt to start a background production server was declined as out of scope). The evidence is build-level and bundle-level: compilation succeeded, a compiled bootstrap chunk was emitted, and the call site references that chunk rather than the raw `.ts`. I also did not build an actual `.wasm` import end-to-end.

### B4. Client-side file upload, object URLs, and the `<img>` lint rule

**File → ArrayBuffer.** Use the promise-based method on `Blob`, not `FileReader`: [`Blob.arrayBuffer()`](https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer) returns `Promise<ArrayBuffer>`. `File` inherits it. This is what pdf.js and pdf-lib both want.

**Object URL lifecycle.** [`URL.createObjectURL()`](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) creates an entry that lives for the lifetime of the document, so each one must be released with `URL.revokeObjectURL()`. In React, create and revoke in the same effect:

```tsx
useEffect(() => {
  const url = URL.createObjectURL(file);
  setSrc(url);
  return () => URL.revokeObjectURL(url);
}, [file]);
```

**The `<img>` rule and the correct escape hatch.** The ban is real and comes from the shared ultracite preset:

```js
// node_modules/ultracite/config/oxlint/next/index.mjs:30
"nextjs/no-img-element": "error",
```

`oxlint.config.ts` extends `ultracite/oxlint/next`, so it applies repo-wide.

I tested the rule empirically with the repo's own oxlint binary on a scratch file:

```console
$ oxlint -c .oxlintrc.json t.tsx
t.tsx:2:11: error next(no-img-element): Using `<img>` could result in slower LCP and higher
  bandwidth. help: Consider using `<Image />` from `next/image` or ...
```

Two findings from that run:

1. A bare `<img>` errors.
2. **An `<img>` nested inside `<picture>` is _not_ flagged.** Only one error was reported, for the bare case. That is a working escape hatch, but it is an implicit one.

**The better answer: `next/image` already handles blob/data URLs natively.** From `node_modules/next/dist/shared/lib/get-img-props.js:272-276`:

```js
if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
  // https://developer.mozilla.org/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
  unoptimized = true;
  isLazy = false;
}
```

Next detects `blob:`/`data:` and forces `unoptimized` itself — the optimizer is never invoked and no `next.config` `images.remotePatterns` entry is needed. So this is lint-clean and correct:

```tsx
<Image src={objectUrl} alt="" width={w} height={h} unoptimized />
```

Passing `unoptimized` explicitly is redundant but self-documenting, and it is the documented switch: "`true`: The source image will be served as-is from the `src`" (`01-app/03-api-reference/02-components/image.md:391-405`).

**Recommendation:** use `next/image` with `unoptimized` for user-supplied blob URLs in _chrome_ UI (thumbnails, the page list, the image-object inspector). For pixels that live **inside the editor overlay** — where you need exact transform control, no wrapper `<span>`, and no lazy-loading machinery — prefer drawing to `<canvas>` or using the `<picture><img/></picture>` form, and treat the latter as a deliberate, commented exception.

---

## C. High-performance drag / resize / rotate on a DOM overlay

### C1. Pointer Events — the standards-correct drag loop

**`setPointerCapture` is the mechanism.** From [MDN `Element.setPointerCapture()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture):

> "used to designate a specific element as the capture target of future pointer events. Subsequent events for the pointer will be targeted at the capture element until capture is released"

Signature: `setPointerCapture(pointerId)`. Throws `NotFoundError` if `pointerId` matches no active pointer.

MDN's own canonical example is precisely the drag pattern we want — note `touch-action: none` in the CSS and the direct `style.transform` write in the move handler:

```js
function beginSliding(e) {
  slider.onpointermove = slide;
  slider.setPointerCapture(e.pointerId);
}
function slide(e) {
  slider.style.transform = `translate(${e.clientX - 70}px)`;
}
slider.onpointerdown = beginSliding;
```

**You do not need to call `releasePointerCapture` on pointerup.** Per [Pointer Events Level 3, §9.5 Implicit release of pointer capture](https://www.w3.org/TR/pointerevents3/):

> "Immediately after firing the pointerup or pointercancel events, the user agent MUST clear the pending pointer capture target override for the pointerId of the pointerup or pointercancel event that was just dispatched, and then run process pending pointer capture steps to fire lostpointercapture if necessary."

The spec also notes that if the capturing element is removed from the DOM mid-gesture, capture falls back to the document (§9.5) — relevant if an object can be deleted during a drag.

**Always handle `pointercancel`, not just `pointerup`.** From [MDN `pointercancel` event](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event), the browser fires it when:

- a hardware event cancels pointer activity (app switcher, home button);
- screen orientation changes while the pointer is active;
- the browser decides input was accidental (palm rejection);
- **"The `touch-action` CSS property prevents the input from continuing"**;
- too many simultaneous pointers.

A drag that only listens for `pointerup` will leave the editor stuck mid-gesture. Treat `pointercancel` as "revert to the pre-drag state".

**`touch-action: none` on the overlay.** From [MDN `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action):

> "By default, panning (scrolling) and pinching gestures are handled exclusively by the browser. An application using Pointer events will receive a `pointercancel` event when the browser starts handling a touch gesture."

and

> "the browser intersects the `touch-action` values of the touched element and its ancestors, up to the one that implements the gesture ... in practice, `touch-action` is typically applied only to top-level elements which have some custom behavior, without needing to specify `touch-action` explicitly on any of that element's descendants."

So set `touch-action: none` once on the overlay root, not per object. Note the accessibility warning on the same page: `touch-action: none` "may inhibit operating a browser's zooming capabilities" — so scope it to the overlay, never `body`. Also: "After a gesture starts, changes to `touch-action` will not have any impact on the behavior of the current gesture" — you cannot toggle it in `pointerdown`; it must already be set.

**Preventing text selection during drag.** `touch-action` does not cover mouse text selection. Use CSS `user-select: none` on the overlay during a gesture (Tailwind `select-none`) rather than `preventDefault()` on `pointerdown` — Base UI's own slider does exactly this (`components/ui/slider.tsx`: `"flex touch-none select-none ..."` on `SliderPrimitive.Control`), which is a useful in-repo precedent for the convention.

**`getCoalescedEvents()` — use it for freehand drawing only, and feature-detect.** [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents) describes it as returning the un-coalesced moves merged into one `pointermove`:

> "Un-coalesced position changes are desirable in drawing applications, for instance, where having access to all events helps to build smoother curves that better match the movement of a pointer."

MDN currently labels it **"Limited availability … not Baseline"**. The authoritative compat data (`mdn/browser-compat-data`, `api/PointerEvent.json` → `getCoalescedEvents.__compat.support`) explains why — Safari was very late:

| Engine     | Added          |
| ---------- | -------------- |
| Chrome     | 58             |
| Firefox    | 59             |
| Edge       | mirrors Chrome |
| **Safari** | **18.2**       |

Desktop-first makes this acceptable, but guard it: `const pts = e.getCoalescedEvents?.() ?? [e];`

Use it for **freehand / signature strokes only**. For drag/resize/rotate, the single coalesced event is what you want — replaying intermediate points just does redundant work for an identical final position.

The spec also describes `pointerrawupdate` (higher frequency than `pointermove`) but explicitly warns against it here: "Adding listeners for the pointerrawupdate event might negatively impact the performance of the web page … A pointerrawupdate listener should only be added if JavaScript needs high frequency events and can handle them just as fast" (Pointer Events L3 §4.2.5). **Do not use it.**

### C2. Keeping drag at 60fps in React — refs + direct style mutation

**Verdict: mutate the DOM directly during the gesture; commit one state update on `pointerup`.** State-per-`pointermove` is the wrong design. Three independent primary sources agree.

**1. Vercel's React performance guidance** — `rerender-use-ref-transient-values` (`~/.cursor/skills/vercel-react-best-practices/rules/rerender-use-ref-transient-values.md`, authored by Vercel, MIT). It is exactly our scenario:

> "When a value changes frequently and you don't want a re-render on every update (e.g., mouse trackers, intervals, transient flags), store it in `useRef` instead of `useState`. Keep component state for UI; use refs for temporary DOM-adjacent values."

Its "Correct (no re-render for tracking)" example is the pattern verbatim:

```tsx
const onMove = (e: MouseEvent) => {
  lastXRef.current = e.clientX;
  const node = dotRef.current;
  if (node) {
    node.style.transform = `translateX(${e.clientX}px)`;
  }
};
```

Its "Incorrect (renders every update)" example is `setLastX(e.clientX)` on every move.

Related rules from the same set: `rerender-defer-reads` ("Don't subscribe to state only used in callbacks"), `advanced-use-latest`, `advanced-event-handler-refs`, and `rerender-transitions`/`rerender-use-deferred-value` for the commit.

**2. MDN on the rendering pipeline** — [Animation performance and frame rate](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate). The budget and the property costs:

> "For a rate of 60 frames per second, the browser has 16.7 milliseconds to execute scripts, recalculate styles and layout if needed, and repaint the area being updated."

The waterfall is Recalculate Style → Layout → Paint → Composite, and cost depends on the property:

> - Properties that affect an element's geometry or position trigger a: style recalculation, layout, repaint. For example: `left`, `max-width`, `border-width`, `margin-left`, `font-size`
> - Properties that do not affect geometry or position and are not rendered in their own layer … do trigger a: style recalculation, repaint. For example: `color`
> - **"Properties that are rendered in their own layer don't even trigger a repaint, because the update is handled in composition. These do trigger: style recalculation. For example: `transform`, `opacity`"**

So: **animate `transform` and `opacity` only.** Never drive a drag with `left`/`top`/`width`/`height` — each is a full layout + paint every frame.

**3. Vercel on layout thrashing** — `js-batch-dom-css`:

> "Avoid interleaving style writes with layout reads. When you read a layout property (like `offsetWidth`, `getBoundingClientRect()`, or `getComputedStyle()`) between style changes, the browser is forced to trigger a synchronous reflow."

Concretely, for the drag loop: **read geometry once in `pointerdown`**, cache it in a ref, and do pure arithmetic in `pointermove`. Calling `getBoundingClientRect()` inside `pointermove` forces a synchronous layout every frame and is the single most common way this gets slow.

**The resulting shape:**

```tsx
// pointerdown: capture, snapshot geometry ONCE
const startRef = useRef<{
  px: number;
  py: number;
  ox: number;
  oy: number;
} | null>(null);

function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
  e.currentTarget.setPointerCapture(e.pointerId);
  startRef.current = { px: e.clientX, py: e.clientY, ox: obj.x, oy: obj.y };
}

// pointermove: NO setState, NO layout reads — one compositor-only write
function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
  const s = startRef.current;
  if (!s) return;
  const dx = (e.clientX - s.px) / zoomRef.current;
  const dy = (e.clientY - s.py) / zoomRef.current;
  nodeRef.current!.style.transform = `translate3d(${s.ox + dx}px, ${s.oy + dy}px, 0)`;
}

// pointerup / pointercancel: ONE committed state update
function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
  const s = startRef.current;
  startRef.current = null;
  if (!s) return;
  commit({
    x: s.ox + (e.clientX - s.px) / zoom,
    y: s.oy + (e.clientY - s.py) / zoom,
  });
}
```

Notes:

- Divide deltas by the zoom factor — pointer deltas are in CSS px, object coords are in document space.
- Push a **single** history entry on commit, not one per move. This is also what makes undo/redo behave correctly.
- Use `useEffectEvent` for handlers that need fresh `zoom`/`snap` without re-binding listeners (B1).
- `will-change: transform` on the dragged element only, added on `pointerdown` and removed on commit — leaving it on permanently for every object wastes GPU memory.
- One `pointermove` listener on the overlay root (event delegation) beats one per object. Vercel's `client-event-listeners` ("Deduplicate global event listeners") supports this.
- React's own `onPointerMove` prop is fine — React 19 attaches at the root container. `rAF`-throttling is generally unnecessary because `pointermove` is already coalesced to the frame rate (that is what `getCoalescedEvents` exists to undo).

### C3. Rotation + resize math with a rotated bounding box

**The core gotcha, from the spec.** `getBoundingClientRect()` does **not** give you a rotated element's own width/height. [CSSOM View, `getClientRects()`](https://drafts.csswg.org/cssom-view/#dom-element-getclientrects) step 3 requires:

> "Apply the transforms that apply to the element and its ancestors."

and `getBoundingClientRect()` returns

> "a `DOMRect` object describing the smallest rectangle that includes all of the rectangles in list"

So for a rotated element you get the **axis-aligned bounding box of the rotated shape**, which is larger than the element and changes as it rotates. **Never derive object dimensions from `getBoundingClientRect()` during resize.** Keep `{ x, y, width, height, rotation }` in your own model as the single source of truth and treat the DOM as an output.

Let an object be centre `C = (cx, cy)`, unrotated size `w × h`, rotation `θ`. Define

```
R(θ) = [ cos θ  -sin θ ]
       [ sin θ   cos θ ]
```

**Handle positions.** A handle at local offset `l` (from the centre, in unrotated object space) sits at document position:

```ts
const cos = Math.cos(theta),
  sin = Math.sin(theta);
function toDocument(lx: number, ly: number, cx: number, cy: number) {
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}
// the four corners are l = (±w/2, ±h/2); edge handles are (±w/2, 0) and (0, ±h/2)
```

The inverse — turning a document-space pointer position into object-local coordinates — is rotation by `-θ`:

```ts
function toLocal(px: number, py: number, cx: number, cy: number) {
  const dx = px - cx,
    dy = py - cy;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}
```

Cursor affordances should be rotated too: the visual cursor for a corner handle is `(baseAngle + θ)` normalised into 8 octants.

**Resizing a rotated element around a fixed opposite corner.** The naive approach — recompute `x/y/width/height` in document space — makes the anchor drift, which is the classic bug. The standards-correct approach keeps the **anchor fixed in document space** and recomputes the centre:

1. On `pointerdown`, compute and freeze the anchor (the corner diagonally opposite the grabbed handle) in **document** space, using `toDocument` above. Also freeze `θ`, `w`, `h`, `C`.
2. On each move, convert the current pointer into **object-local** space _about the frozen anchor_ by rotating by `-θ`. The local delta from the anchor gives the new unrotated size directly:

   ```ts
   const { x: lx, y: ly } = rotate(
     pointer.x - anchor.x,
     pointer.y - anchor.y,
     -theta
   );
   const newW = Math.max(MIN_SIZE, Math.abs(lx));
   const newH = Math.max(MIN_SIZE, Math.abs(ly));
   ```

   (Signs of `lx`/`ly` tell you whether the object flipped past the anchor.)

3. The new centre is the anchor plus half the new local size, rotated **back** into document space:

   ```ts
   const sx = Math.sign(lx) || 1,
     sy = Math.sign(ly) || 1;
   const half = rotate((sx * newW) / 2, (sy * newH) / 2, theta);
   const newCx = anchor.x + half.x;
   const newCy = anchor.y + half.y;
   ```

Because the anchor never moves and the centre is derived from it, the opposite corner stays pinned exactly, at any rotation. Aspect-ratio locking is applied to `newW`/`newH` in step 2, before step 3.

**Rotation itself** is the simplest of the three: `θ = atan2(pointer.y - cy, pointer.x - cx)` minus the grab offset captured at `pointerdown`. Snap with `Math.round(θ / (Math.PI / 12)) * (Math.PI / 12)` for 15° increments when Shift is held.

**Render order matters.** `transform` functions apply right-to-left, so `translate(...) rotate(...)` rotates about the element's own `transform-origin` and then moves it — which is what you want. Keep `transform-origin: center` and store `x/y` as the centre (or convert consistently); mixing top-left and centre conventions is the other classic source of drift.

**Not verified:** this is derived mathematics, presented because the trigonometry is standard and verifiable by inspection. It was **not** implemented and run. It should get unit tests (section D) asserting anchor-invariance: after a simulated resize at θ = 0, 30°, 90°, 217°, the anchor corner computed from the new `{C, w, h, θ}` must equal the frozen anchor within ~1e-9.

### C4. `ResizeObserver` and `visualViewport` for fit-to-width / fit-to-page

**`ResizeObserver` for the container.** From [MDN `ResizeObserver.observe()`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver/observe):

```
observe(target)
observe(target, options)   // options.box: 'content-box' | 'border-box' | 'device-pixel-content-box'
```

- `content-box` (default) — CSS content area.
- `border-box` — includes padding and border.
- **`device-pixel-content-box`** — "The size of the content area as defined in CSS, in device pixels, **before applying any CSS transforms** on the element or its ancestors."

That last one is the right box for **sizing a `<canvas>` backing store**: it gives true device pixels, so you can set `canvas.width` exactly and get crisp rendering on HiDPI without guessing at `devicePixelRatio`. Use `content-box`/`border-box` for the fit-to-width arithmetic itself.

Read `entry.contentBoxSize[0].inlineSize` (an array) rather than the deprecated `contentRect`, per MDN's example. Note `inlineSize`/`blockSize` are writing-mode relative — with `dir="rtl"` configured in `components.json`, `inlineSize` is still the horizontal axis for horizontal writing modes, but do not assume `inlineSize === width` if a vertical writing mode is ever introduced.

Guard against zero: a collapsed or `display: none` container (including anything inside `<Activity mode="hidden">`, see B1) reports `0 × 0`, and dividing by it yields `Infinity` zoom.

**`visualViewport` is for pinch-zoom and the on-screen keyboard, not for fit-to-width.** From [MDN `VisualViewport`](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport):

> "The mobile web contains two viewports, the layout viewport and the visual viewport. … When the user pinch-zooms into the page, the visual viewport shrinks but the layout viewport is unchanged. User-interface features like the on-screen keyboard (OSK) can shrink the visual viewport without affecting the layout viewport."

Properties: `offsetLeft`, `offsetTop`, `pageLeft`, `pageTop`, `width`, `height`, `scale`. Events: `resize`, `scroll`, `scrollend`. Accessed via `window.visualViewport`.

Critically for a desktop-first app:

> "Only the top-level window has a visual viewport that's distinct from the layout viewport."

**Recommendation:** drive fit-to-width and fit-to-page from `ResizeObserver` on the scroll container — it is the correct box, it fires for sidebar/panel resizes that `window.resize` misses, and it is Baseline. Use `visualViewport` only if you later need to detect browser pinch-zoom (`visualViewport.scale > 1`) to avoid compounding it with the editor's own zoom. `window.resize` alone is insufficient: it does not fire when a side panel opens.

---

## D. Testing — pure logic unit tests only

Scope: coordinate conversions, history stack, page ordering, export math. No DOM, no components.

I tested both candidates empirically in the scratch dir.

### `node:test` — zero dependencies, but it cannot resolve this repo's imports

Node 24.15.0 runs TypeScript tests with no config, no dependencies, and no transpile step:

```console
$ node --test
✔ flips y (1.8805ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

But two import conventions this repo relies on both fail:

```console
# 1. The '@/' path alias from tsconfig.json
$ node --test alias.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/math.ts'

# 2. Extensionless / bundler-style specifiers
$ node --test js.test.ts       # importing './math.js' for math.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\math.js'
```

Node's ESM resolver requires **relative specifiers with the literal `.ts` extension** (`import { toPdfY } from './math.ts'`). The repo's `tsconfig.json` sets `"moduleResolution": "bundler"` and `"paths": { "@/*": ["./*"] }`, and the whole codebase imports as `@/lib/...` (every file in `components/ui/` uses `@/lib/utils`). Node's `imports` field only supports `#`-prefixed subpaths, so `@/*` cannot be mapped without a custom loader.

Adopting `node:test` would therefore mean either writing `../../lib/foo.ts` in tests while source uses `@/lib/foo`, or maintaining a custom resolver hook. Both are worse than one dev dependency.

### Vitest — verified working with this repo's exact tsconfig

Installed `vitest@5.0.1` in the scratch dir against a tsconfig copying this repo's `moduleResolution: "bundler"` + `paths` setup. The alias resolves:

```console
$ npx vitest run
 ✓ math.test.ts (1 test)
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  832ms
```

The bundled Next docs recommend the `vite-tsconfig-paths` plugin (`01-app/02-guides/testing/vitest.md:37`), but **Vitest 5 makes that obsolete** — it printed this during the run:

> "The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the `resolve.tsconfigPaths` option. You can remove the plugin and set `resolve.tsconfigPaths: true` in your Vite config instead."

I verified the plugin-free config works:

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { environment: "node" },
});
```

```console
$ npx vitest run
 Test Files  1 passed (1)   Tests  1 passed (1)   Duration  617ms
```

The bundled Next doc is therefore **out of date on this point** for Vitest 5 — worth knowing, since AGENTS.md directs us to those docs.

### Comparison and recommendation

|  | `node:test` (Node 24) | Vitest 5 |
| --- | --- | --- |
| Dependencies | 0 | 1 (`vitest`) |
| TS support | Native type stripping | Native (esbuild) |
| `@/*` alias | **Fails** — needs a custom loader | Works via `resolve.tsconfigPaths: true` |
| Extensionless imports | **Fails** — `.ts` required | Works |
| Config | none | 4-line `vitest.config.mts` |
| Watch mode | `--watch` | Yes, default for `vitest` |
| Assertions | `node:assert/strict` | `expect` (Jest-compatible) |
| Coverage | `--experimental-test-coverage` | `--coverage` (v8) |
| Next docs | not covered | covered (`testing/vitest.md`) |
| Growth path to component tests | poor | `jsdom` + Testing Library |

**Recommendation: Vitest.** The alias incompatibility is decisive on its own — `node:test` would force a different import convention in tests than in source, in a codebase where `@/` is used universally. Vitest is also the only one of the two the Next docs cover, and it leaves the door open to component tests later without another migration.

**Setup cost: ~5 minutes, one dev dependency, two files.**

```console
pnpm add -D vitest
```

```ts
// vitest.config.mts  (.mts so it is unambiguously ESM under "type": "module")
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node", // pure logic only — no jsdom needed, much faster
    include: ["lib/**/*.test.ts"], // keep tests next to the logic
  },
});
```

```jsonc
// package.json
"test": "vitest run",
"test:watch": "vitest"
```

Add `environment: 'jsdom'` plus `@testing-library/react` **only if** component tests are later needed; keep the default `node` environment for the coordinate/history/export math, which is the stated scope.

One caveat: `oxlint.config.ts` extends `ultracite/oxlint/core`, which may not know Vitest globals. Avoid the issue entirely by importing `{ test, expect }` from `vitest` explicitly rather than setting `test.globals: true`. **Not verified:** I did not run the repo's oxlint against a Vitest test file.

---

## E. Base UI component inventory

### E1. What is already vendored in `components/ui/`

All 30 files read directly. Base UI is `@base-ui/react@1.8.0`. Conventions used throughout:

- Components are plain exported functions returning `React.ReactElement` — **no `forwardRef`** (ref is a prop, per B1).
- Most files re-export the raw primitive as `XPrimitive` for escape hatches.
- Compound parts are flat named exports (`DialogPopup`), not dot-notation.
- Base UI uses **`Popup`** where Radix/shadcn use `Content`; several files add a `Content` alias.
- Styling is `cn()` + `cva` variants; state is exposed via `data-*` attributes (`data-pressed`, `data-[orientation=…]`, `data-dragging`, `data-disabled`).

Editor-relevant subset:

| File | Base UI? | Key exports | Notes for the editor |
| --- | --- | --- | --- |
| `button.tsx` | Yes (`use-render`, `merge-props`) | `Button`, `buttonVariants`, `ButtonProps` | `ButtonProps extends useRender.ComponentProps<"button">` — supports `render` for polymorphism. Has a built-in `Spinner`. |
| `toolbar.tsx` | Yes (`/toolbar`) | `Toolbar`, `ToolbarButton`, `ToolbarLink`, `ToolbarInput`, `ToolbarGroup`, `ToolbarSeparator`, `ToolbarPrimitive` | **The editor toolbar.** Roving-focus/arrow-key nav comes free. Props typed as `ToolbarPrimitive.Root.Props` etc. |
| `toggle.tsx` | Yes (`/toggle`) | `Toggle`, `toggleVariants`, `TogglePrimitive` | **Tool selection.** Note `TogglePrimitive` is used directly, _not_ `.Root`. Variants `default`/`outline`, sizes `sm`/`default`/`lg`. Styles key off `data-pressed`. |
| `tooltip.tsx` | Yes (`/tooltip`) | `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipPopup`, `TooltipContent` (alias), `TooltipCreateHandle` | **Requires `TooltipProvider`** mounted above. Pair with `Kbd` for shortcut hints. |
| `popover.tsx` | Yes (`/popover`) | `Popover`, `PopoverTrigger`, `PopoverPopup`, `PopoverContent` (alias), `PopoverClose`, `PopoverTitle`, `PopoverDescription`, `PopoverCreateHandle` | Host for colour/stroke/font sub-panels. |
| `select.tsx` | Yes (`/select`) | `Select`, `SelectTrigger`, `SelectButton`, `SelectValue`, `SelectPopup`/`SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `selectTriggerVariants` | Font family, page size, export preset. |
| `slider.tsx` | Yes (`/slider`) | `Slider`, `SliderValue`, `SliderPrimitive` | **Opacity / stroke width / zoom.** Wrapper renders Control→Track→Indicator→Thumb internally; you only pass `Root.Props`. Handles multi-thumb via array `value`. Already sets `thumbAlignment="edge"`, `touch-none select-none`, and `data-dragging:scale-120`. |
| `dialog.tsx` | Yes (`/dialog`) | `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogBackdrop`, `DialogViewport`, `DialogPopup`, `DialogHeader`/`Footer`/`Title`/`Description`/`Panel`, `DialogClose`, `DialogCreateHandle` | Export settings, upload. Note the extra `Viewport` + `Panel` parts vs. stock shadcn. |
| `alert-dialog.tsx` | Yes (`/alert-dialog`) | same shape as Dialog, `AlertDialog*` | Destructive confirms ("discard changes?"). |
| `context-menu.tsx` | Yes (`/context-menu`) | `ContextMenu`, `ContextMenuTrigger`, `ContextMenuPopup`, `ContextMenuItem`, `ContextMenuCheckboxItem`, `ContextMenuRadioGroup`/`RadioItem`, `ContextMenuSub`/`SubTrigger`/`SubPopup`, `ContextMenuSeparator`, `ContextMenuShortcut`, `ContextMenuGroupLabel` | **Right-click on objects**: bring-to-front, duplicate, delete. `ContextMenuShortcut` already exists for the key hint. |
| `menu.tsx` | Yes (`/menu`) | `Menu`, `MenuTrigger`, `MenuPopup`, `MenuItem`, `MenuCheckboxItem`, `MenuRadioGroup`/`RadioItem`, `MenuSub*`, `MenuShortcut`, `MenuCreateHandle` | Dropdown menus in the top bar. |
| `scroll-area.tsx` | Yes (`/scroll-area`) | `ScrollArea`, `ScrollBar`, `ScrollAreaPrimitive` | Page list / layers panel. **Be careful using it as the PDF scroll container** — custom scroll containers complicate `ResizeObserver` + scroll-position math (C4). |
| `tabs.tsx` | Yes (`/tabs`) | `Tabs`, `TabsList`, `TabsTab`, `TabsPanel` | Note **`TabsTab`**, not `TabsTrigger`. Uses `lib/segmented-control.ts` for sizing. |
| `kbd.tsx` | **No** — plain `<kbd>` | `Kbd`, `KbdGroup` | Shortcut hints in tooltips/menus. Pure presentational, `React.ComponentProps<"kbd">`. |
| `empty.tsx` | **No** — plain divs + `cva` | `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` | "No document loaded" state. |
| `spinner.tsx` | **No** — `lucide-react` | `Spinner` | `Loader2Icon` + `animate-spin`, `role="status"`, `aria-label="Loading"`. Props are `ComponentProps<typeof Loader2Icon>`. |
| `toast.tsx` | Yes (`/toast`) | `ToastProvider`, `AnchoredToastProvider`, `toastManager`, `anchoredToastManager`, `ToastPosition`, `ToastPrimitive` | **Imperative API** via `toastManager` — no hook needed to fire one. Export success/failure. Requires a provider mounted. |

Also available and useful: `alert`, `checkbox`, `field`, `form`, `input`, `input-group`, `label`, `separator`, `textarea`, `group`, `frame`, `command`, `autocomplete`.

**Implementation note:** `app/layout.tsx` currently mounts only `ThemeProvider`. Both `TooltipProvider` and `ToastProvider` will need adding before tooltips/toasts work.

### E2. Missing primitives the editor needs

| Need | In `components/ui/`? | In Base UI 1.8.0? | In the shadcn registry? | Recommendation |
| --- | --- | --- | --- | --- |
| **Number / stepper input** (x, y, w, h, rotation, font size) | No | **Yes — `@base-ui/react/number-field`** | **No** (`number-field` → HTTP 404 for `base-nova`) | **Vendor it by hand** from the Base UI primitive, following the local file conventions. This is the highest-value gap: an editor inspector needs numeric inputs with drag-scrub, arrow-key stepping, and min/max. Base UI's `NumberField` gives all of that. |
| **Colour picker** (fill, stroke, highlight) | No | **No** | **No** (404) | **Build in-repo.** Compose `Popover` + existing `Slider` (hue/alpha) + a swatch grid of `Button`s. A curated swatch palette plus a hex `Input` covers most PDF-annotation use and avoids a dependency. A full 2D saturation/value area is a custom `pointerdown`+`setPointerCapture` surface — i.e. reuse the C1/C2 drag machinery. |
| **Resizable panel** (canvas ↔ inspector split) | No | No | **Yes — `resizable`** | **`pnpm dlx shadcn@latest add resizable`.** Verified present for the configured `base-nova` style (HTTP 200). Pulls in `react-resizable-panels` as a runtime dependency. Alternatively a CSS grid with one custom pointer-drag divider, reusing the same drag utilities — avoids the dependency, ~40 lines. |

**How this was verified.** `components.json` declares `"style": "base-nova"` and one extra registry (`"@coss": "https://coss.com/ui/r/{name}.json"`). I probed the shadcn registry directly:

```console
$ GET https://ui.shadcn.com/r/styles/base-nova/resizable.json     → HTTP 200  (deps: react-resizable-panels)
$ GET https://ui.shadcn.com/r/styles/base-nova/slider.json        → HTTP 200
$ GET https://ui.shadcn.com/r/styles/base-nova/kbd.json           → HTTP 200
$ GET https://ui.shadcn.com/r/styles/base-nova/number-field.json  → HTTP 404
$ GET https://ui.shadcn.com/r/styles/base-nova/color-picker.json  → HTTP 404
$ GET https://ui.shadcn.com/r/styles/base-nova/toolbar.json       → HTTP 404
```

The registry index (`https://ui.shadcn.com/r/index.json`) lists **63** items:

> accordion, alert, alert-dialog, aspect-ratio, attachment, avatar, badge, breadcrumb, bubble, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field, form, hover-card, input, input-group, input-otp, item, kbd, label, marker, menubar, message, message-scroller, native-select, navigation-menu, pagination, popover, progress, questionnaire, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toast, toggle, toggle-group, tooltip

Note `toolbar` and `autocomplete` are **not** in that index even though both are vendored in this repo — so some existing components came from a source other than the public shadcn index (plausibly the `@coss` registry or a newer/unlisted style). **Not verified:** I did not probe the `@coss` registry, which may well carry `number-field` or a colour picker. Worth checking before hand-rolling the number field.

Base UI primitives available but not vendored, which may be wanted later: `accordion`, `avatar`, `collapsible`, `combobox`, `drawer`, `menubar`, `meter`, `navigation-menu`, `number-field`, `otp-field`, `preview-card`, `progress`, `radio-group`, `switch`, `toggle-group` (`node_modules/@base-ui/react/package.json` exports map). `toggle-group` in particular is a natural fit for an exclusive tool picker.

---

## Decisions and risks

### Decisions

1. **Do not adopt `@tanstack/react-hotkeys` (A4).** Write ~60 lines in `lib/hotkeys.ts`. The library is self-declared alpha, its `ignoreInputs` default fires `Mod+Z` inside focused textareas, and two open issues (#138 ARIA composite widgets, #142 `Space`) describe our exact UI. Copy its `isInputElement` predicate and `Mod` normalisation. Re-evaluate at 1.0, or sooner if user-remappable shortcuts become a requirement.

2. **Client boundary at `components/editor/editor-shell.tsx` (B2).** `app/editor/page.tsx` stays a Server Component; the shell is `'use client'` and holds the single `dynamic(() => import('./editor-canvas'), { ssr: false })`. `ssr: false` remains valid in the App Router in Next 16 as long as the call is inside a Client Component. Guard server-only modules with the `server-only` package. No barrel file for the editor.

3. **Web Workers need no configuration (B3).** `new Worker(new URL('./x.worker.ts', import.meta.url))` compiles and chunks correctly under Turbopack — verified by an actual `next build`. Move pdf.js parsing and export rasterisation off the main thread from day one.

4. **Drag loop: refs + `transform` + one commit (C2).** `setPointerCapture` on `pointerdown`; snapshot geometry once; in `pointermove` write only `style.transform` with no `setState` and no layout reads; commit a single state update and a single history entry on `pointerup`. Handle `pointercancel` as a revert. `touch-action: none` and `select-none` on the overlay root only.

5. **Own the geometry model (C3).** `{ x, y, width, height, rotation }` in app state is the source of truth; the DOM is an output. Never read a rotated element's size from `getBoundingClientRect()` — the CSSOM View spec mandates it return the _transformed_ axis-aligned box. Resize anchors on the frozen opposite corner in document space and recomputes the centre.

6. **State: `useSyncExternalStore` over a plain external store (B1).** No state library is installed and none is needed. An external store lets the toolbar/inspector subscribe to slices without re-rendering the canvas, and keeps the history stack as plain data — which is exactly what the section D unit tests target. Vercel's `rerender-defer-reads` supports this shape.

7. **Vitest, not `node:test` (D1).** One dev dependency, a 4-line `vitest.config.mts` with `resolve: { tsconfigPaths: true }` (no `vite-tsconfig-paths` plugin — Vitest 5 has it natively, and the bundled Next doc is out of date here). `node:test` cannot resolve this repo's `@/*` aliases.

8. **UI: reuse the vendored set (E1).** `Toolbar` + `Toggle` for tools, `Slider` for numeric ranges, `Popover` for sub-panels, `ContextMenu` for object right-click, `Dialog`/`AlertDialog` for modals, `Kbd` for hints, `Toast` for export feedback. Add `TooltipProvider` and `ToastProvider` to `app/layout.tsx`. Add three missing primitives: hand-vendor a Base UI `NumberField`, build a colour picker from `Popover` + `Slider` + swatches, and either `shadcn add resizable` or write a ~40-line CSS-grid splitter.

9. **Images: `next/image` with `unoptimized` for blob URLs (B4).** Next forces `unoptimized` for `blob:`/`data:` itself, so it is lint-clean with no config. Inside the editor overlay prefer `<canvas>`; `<picture><img/></picture>` is a verified but implicit escape from `nextjs/no-img-element` and should be commented if used.

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Hand-rolled shortcut handler misses an edge case the library already solved (IME composition, `keyup` during window blur, latched modifiers) | Medium | Port `isInputElement` verbatim; ignore events with `event.isComposing`; clear modifier state on `window.blur`. Note TanStack itself has an open bug here (#143). |
| `getCoalescedEvents()` needs Safari 18.2+ (BCD-confirmed) | Low | Only used for freehand/signature strokes. Feature-detect: `e.getCoalescedEvents?.() ?? [e]`. |
| `<Activity mode="hidden">` uses `display: none`, so `ResizeObserver` reports `0 × 0` for hidden pages | Medium | Ignore zero-size `ResizeObserver` entries; recompute fit-to-width on the transition back to visible. **Not measured** — verify early. |
| Turbopack also emits raw uncompiled `.ts` worker source to `static/media/` | Low | Cosmetic/disclosure only; the executed chunk is the compiled one. Do not reference that URL. Re-check on Next upgrades. |
| Rotation/resize math is derived, not executed | Medium | Unit-test anchor-invariance across θ = 0/30/90/217° before wiring to the UI (section D exists for this). |
| `ScrollArea` as the PDF scroll container complicates viewport math | Medium | Use a native scroll container for the page canvas; reserve `ScrollArea` for sidebars. |
| Pinning `@base-ui/react@^1.8.0` with a caret while vendored wrappers depend on internal part names (`Popup`, `TabsTab`, `Toolbar.Root.Props`) | Low-Medium | Base UI is 1.x/stable, but the wrappers are type-coupled to part names. `pnpm typecheck` will catch breaks; consider pinning exactly. |
| Next's vendored React (19.3 canary) differs from the app's `react@19.2.8` | Low | Client components resolve the app's copy; both expose `Activity` + `useEffectEvent`. Keep `react`/`react-dom` exactly pinned (they already are). |

### Explicitly not verified

- `@tanstack/react-hotkeys` was never executed in a browser; hosted docs not fetched; issue bodies not read.
- The Turbopack worker was **not** run in a browser — evidence is build- and bundle-level only.
- No `.wasm` import was built end-to-end.
- `<Activity>` + `ResizeObserver`/`<canvas>` interaction was not measured.
- The C3 rotation/resize math was derived, not implemented or tested.
- The `@coss` registry (declared in `components.json`) was not probed; it may supply `number-field` or a colour picker.
- oxlint was not run against a Vitest test file, so Vitest-globals lint behaviour is unconfirmed (avoided by importing `test`/`expect` explicitly).
