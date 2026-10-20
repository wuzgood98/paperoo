# Paperoo

A lightweight web PDF editor. Open, edit, export, and print PDFs in the browser — files never leave your machine.

## Features

- Open a PDF with the file picker, drag-and-drop, or the bundled sample (`⌘O` / `Ctrl+O`)
- Overlay tools: select, text, image, draw, signature, highlight, and shapes (rectangle, line, circle)
- Edit existing page content: text runs, images, vectors, annotations (links, markup, free text, notes, stamps), and AcroForm fields
- OCR scanned pages with Tesseract.js; search native text, overlay text, and OCR words
- Reorder, rotate, and delete pages from the thumbnail sidebar (the last page cannot be deleted)
- Zoom 10%–800%, fit page, fit width, undo/redo, export, and print the edited PDF

## Getting started

Requires Node.js `^20.19.0 || ^22.13.0 || >=24` and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev
```

`pnpm install` copies pdf.js assets and Tesseract/OCR files into `public/` (`scripts/copy-pdfjs-assets.mjs`, `scripts/copy-ocr-assets.mjs`).

## Scripts

| Command          | Description                  |
| ---------------- | ---------------------------- |
| `pnpm dev`       | Start the Next.js dev server |
| `pnpm build`     | Production build             |
| `pnpm start`     | Serve the production build   |
| `pnpm test`      | Run Vitest                   |
| `pnpm typecheck` | TypeScript (`tsc --noEmit`)  |
| `pnpm check`     | Ultracite lint/format check  |
| `pnpm fix`       | Ultracite auto-fix           |
| `pnpm lint`      | ESLint                       |
| `pnpm format`    | Prettier on TypeScript files |

## Shortcuts

| Action | Keys |
| --- | --- |
| Open | `⌘O` / `Ctrl+O` |
| Undo | `⌘Z` / `Ctrl+Z` |
| Redo | `⇧⌘Z` / `Ctrl+Shift+Z` or `⌘Y` / `Ctrl+Y` |
| Print | `⌘P` / `Ctrl+P` |
| Zoom in / out | `⌘=` / `⌘-` (`Ctrl` on Windows/Linux) |
| Delete selection | `Delete` or `Backspace` |
| Nudge selection | Arrow keys (`Shift` for 10px) |
| Previous / next page | `Page Up` / `Page Down` |
| Leave tool / deselect | `Esc` |
| Tools | `V` select, `T` text, `I` image, `D` draw, `S` signature, `H` highlight, `R` shapes |
| Toggle light / dark theme | `M` |

## Limits

- Maximum file size: 80 MB
- Maximum page count: 200
- Encrypted PDFs cannot be opened or exported

## Stack

Next.js 16, React 19, pdf.js for rendering, pdf-lib for export, Tesseract.js for OCR, Tailwind CSS 4.

Page views are counted with [Vercel Web Analytics](https://vercel.com/docs/analytics), which uses no cookies. It records which page was visited, never your files or their contents.

## Layout

```
app/                  App Router entry
components/editor/    Editor UI
lib/editor/           Editor state and types
lib/pdf/              Load, extract, export, print
lib/ocr/              OCR session and search
test/                 Vitest suites
```
