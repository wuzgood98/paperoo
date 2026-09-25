# Build a Web-Based PDF Editor

Build a polished, production-quality web PDF editor.

The core idea is:

> Upload a PDF → visually edit it using an overlay layer → export a new PDF.

We are **not** trying to directly modify the original PDF content yet. The first version should use an editor/overlay model, but the architecture must be designed so that true PDF-content editing can be added later without rewriting the editor.

## Tech stack

Use:

- Next.js with App Router
- TypeScript
- Tailwind CSS
- shadcn/ui where appropriate
- PDF.js for rendering PDFs
- pdf-lib for generating/exporting the final PDF
- React for the editor state/UI

Use strict TypeScript.

Do not use `any`.

Prefer small, composable components and utilities over large components.

Do not introduce unnecessary dependencies.

---

# Product goal

The editor should feel closer to a lightweight Canva/Figma editor than Adobe Acrobat.

The user should be able to:

1. Upload a PDF.
2. See the PDF pages in an editor.
3. Navigate between pages.
4. Zoom in/out.
5. Add text.
6. Move and resize text.
7. Add images.
8. Move and resize images.
9. Draw on the PDF.
10. Add a signature.
11. Highlight areas.
12. Add simple shapes.
13. Select and delete objects.
14. Undo/redo changes.
15. Export the edited document as a PDF.

The original PDF should remain untouched internally.

All user edits should exist as editor objects layered above the rendered PDF.

---

# Core architecture

Treat every PDF page as a coordinate space.

Conceptually:

```text
PDF Document
│
├── Page 1
│   ├── Original PDF
│   └── Editor objects
│       ├── Text
│       ├── Image
│       ├── Drawing
│       ├── Signature
│       ├── Highlight
│       └── Shape
│
├── Page 2
│   ├── Original PDF
│   └── Editor objects
│
└── ...
```

The original PDF is the background.

The editor objects are an independent layer.

Do NOT rasterize the entire PDF just to implement editing.

---

# Editor document model

Create a strongly typed editor document model.

Something conceptually similar to:

```ts
type EditorDocument = {
  pages: EditorPage[];
};

type EditorPage = {
  id: string;
  width: number;
  height: number;
  objects: EditorObject[];
};

type EditorObject =
  | TextObject
  | ImageObject
  | ShapeObject
  | DrawingObject
  | HighlightObject
  | SignatureObject;
```

Every object should have common properties such as:

```ts
type BaseObject = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};
```

Use discriminated unions for object types.

Do not use loose objects or `any`.

Keep the editor document model independent from PDF.js and pdf-lib.

This is important because later we may add true PDF content editing.

---

# Coordinate system

Use PDF page coordinates as the canonical coordinate system.

The editor UI may scale pages for zooming, but object positions should remain independent of the current zoom level.

For example:

```text
PDF page:
612 × 792

Zoom:
50%

Displayed page:
306 × 396
```

An object at:

```text
x: 100
y: 200
```

must remain at those document coordinates regardless of zoom.

Create reusable coordinate conversion utilities for:

- PDF → screen
- screen → PDF
- mouse position → page position
- page position → rendered position

Do not scatter coordinate calculations throughout components.

---

# PDF rendering

Use PDF.js to:

- Load uploaded PDFs
- Read page dimensions
- Render PDF pages
- Render the appropriate page at the current scale

The PDF rendering layer should be separate from the editor layer.

Conceptually:

```tsx
<Page>
  <PdfCanvas />
  <EditorCanvas />
</Page>
```

The PDF canvas is read-only.

The editor canvas contains all editable objects.

---

# Editor interaction

The user should be able to:

- Click an object to select it.
- Drag selected objects.
- Resize selected objects.
- Delete selected objects.
- Press Escape to deselect.
- Use Delete/Backspace to remove selected objects.
- Use arrow keys to nudge selected objects.
- Hold Shift where appropriate for constrained movement/resizing.

Selected objects should have a visible bounding box and resize handles.

Do not make objects difficult to select because of the PDF background.

---

# Text tool

Implement a text tool.

When the user activates the text tool and clicks the page:

Create a text object.

Support:

- Text content
- Font size
- Font family
- Font weight
- Italic
- Text color
- Alignment
- Opacity
- Width/height
- Rotation

Initially support a small sensible set of fonts.

Text should be editable directly in the editor.

Avoid requiring a modal just to edit text.

Double-clicking a text object should enter text-edit mode.

---

# Image tool

Allow the user to upload an image and place it on the PDF.

Support:

- PNG
- JPEG
- WebP if practical

The image should:

- Be draggable
- Be resizable
- Preserve aspect ratio by default
- Be rotatable
- Support opacity
- Be deletable

Do not permanently modify the uploaded source image.

---

# Drawing tool

Implement a freehand drawing tool.

The user should be able to draw with the mouse or pointer.

Store drawings as vector-like paths rather than immediately rasterizing them.

For example:

```ts
type DrawingObject = {
  type: "drawing";
  points: Array<{
    x: number;
    y: number;
  }>;
  stroke: string;
  strokeWidth: number;
};
```

Support:

- Stroke color
- Stroke width
- Undo
- Delete

Use pointer events so this can eventually work with touch/stylus input.

---

# Signature tool

Create a signature tool using the drawing system.

The user should be able to:

1. Open a signature area.
2. Draw their signature.
3. Confirm it.
4. Place it on the PDF.
5. Move/resize it.

The signature should become a normal editor object after creation.

---

# Highlight tool

Implement a highlight object.

The highlight should:

- Be rectangular initially
- Have adjustable color
- Have transparency
- Be movable
- Be resizable
- Be deletable

Use transparency so the underlying PDF remains visible.

---

# Shapes

Initially support:

- Rectangle
- Line
- Circle

Shapes should be:

- Selectable
- Movable
- Resizable
- Rotatable where appropriate
- Styled with stroke/fill
- Deletable

Keep the shape architecture extensible.

---

# Page management

Provide a page sidebar with thumbnails.

Users should be able to:

- See all pages
- Select a page
- Reorder pages
- Rotate a page
- Delete a page

Do not destroy the original PDF while doing this.

Page operations should be represented in the editor document/state.

---

# Zoom and navigation

Implement:

- Zoom in
- Zoom out
- Fit page
- Fit width
- Current zoom indicator

The editor should remain usable at different zoom levels.

Do not tie object coordinates directly to screen pixels.

---

# Undo / redo

Implement proper editor history.

Actions that should be undoable include:

- Add object
- Delete object
- Move object
- Resize object
- Rotate object
- Edit text
- Change style
- Draw
- Add/delete/reorder pages

Use immutable state updates.

Keyboard shortcuts:

```text
Cmd/Ctrl + Z → Undo
Cmd/Ctrl + Shift + Z → Redo
```

Use tanstack hotkeys for keyboard shortcuts

History should operate on editor state, not on the rendered PDF canvas.

---

# Export

Use pdf-lib to export the final document.

The export pipeline should:

1. Load the original PDF.
2. Iterate through the editor pages.
3. Apply page operations.
4. Draw editor objects onto the corresponding PDF pages.
5. Save the resulting PDF.
6. Trigger a browser download.

For example:

```text
Original PDF
      ↓
pdf-lib
      ↓
Apply page transformations
      ↓
Render text objects
      ↓
Render images
      ↓
Render drawings
      ↓
Render signatures
      ↓
Render highlights
      ↓
Render shapes
      ↓
Final PDF
```

Keep the export implementation separate from the editor UI.

Create an abstraction such as:

```ts
exportDocument(document, sourcePdf);
```

Do not put PDF generation logic directly inside React components.

---

# Important export considerations

Remember that the editor may display pages at arbitrary zoom levels, while the PDF has its own dimensions.

Never export using screen coordinates directly.

Convert editor coordinates into PDF coordinates before drawing.

Pay attention to the difference between browser coordinates and PDF coordinates, especially the Y-axis direction.

Text rendering must account for font size and positioning.

Images must maintain their aspect ratio.

Drawings should scale correctly.

---

# UI layout

Create a clean professional editor interface.

Desktop-first.

Suggested layout:

```text
┌──────────────────────────────────────────────────────┐
│ Logo │ File │ Edit │ Undo │ Redo │ Zoom │ Export PDF │
├─────────────┬──────────────────────────────┬─────────┤
│             │                              │         │
│ Page        │                              │ Tools   │
│ thumbnails  │          PDF PAGE            │         │
│             │                              │ Select  │
│  ┌───────┐  │                              │ Text    │
│  │ Page1 │  │                              │ Image   │
│  └───────┘  │                              │ Draw    │
│             │                              │ Sign    │
│  ┌───────┐  │                              │ Highlight│
│  │ Page2 │  │                              │ Shape   │
│  └───────┘  │                              │         │
│             │                              │         │
└─────────────┴──────────────────────────────┴─────────┘
```

Keep the UI minimal.

Do not overwhelm the user with settings before they need them.

Use shadcn/ui components for things like:

- Buttons
- Dropdowns
- Tooltips
- Dialogs
- Popovers
- Sliders

---

# State management

Do not introduce Redux unless there is a compelling reason.

Use a clean local state architecture or a lightweight state library if the project already uses one.

Keep these concepts separate:

```text
PDF state
Editor document state
Selection state
Tool state
History state
UI state
```

Avoid putting everything into one giant state object.

---

# File handling

For the MVP:

- Keep uploaded PDFs client-side.
- Do not require authentication.
- Do not require a database.
- Do not require cloud storage.

The first version should work without a backend.

Later we can add:

- Accounts
- Saved documents
- Cloud storage
- Sharing
- Collaboration
- Billing

Design the code so these can be added later.

---

# Error handling

Handle:

- Invalid PDFs
- Corrupt PDFs
- Unsupported files
- Failed image loading
- Failed PDF rendering
- Export failures
- Very large PDFs

Show useful user-facing errors.

Do not silently fail.

---

# Performance

Be careful with large PDFs.

Do not render every page at massive resolution simultaneously.

Use reasonable rendering scales.

Lazy-render pages where practical.

Avoid unnecessary React re-renders while dragging objects.

Dragging an object should feel smooth.

---

# Mobile

The initial editor is desktop-first.

However:

- Use pointer events.
- Avoid desktop-only mouse APIs where possible.
- Keep the architecture compatible with future touch support.

Do not spend significant time building a mobile editor yet.

---

# Project structure

Organize the editor into clear modules.

For example:

```text
components/
  editor/
    editor.tsx
    editor-toolbar.tsx
    editor-canvas.tsx
    editor-object.tsx
    selection-box.tsx
    page-sidebar.tsx
    tools/
      text-tool.tsx
      image-tool.tsx
      drawing-tool.tsx
      signature-tool.tsx
      highlight-tool.tsx
      shape-tool.tsx

lib/
  pdf/
    load-pdf.ts
    render-page.ts
    export-pdf.ts
  editor/
    types.ts
    coordinates.ts
    history.ts
    object-utils.ts
```

Adapt this structure to the existing project rather than blindly creating duplicate patterns.

---

# Architecture for future true PDF editing

This is extremely important.

Do not assume the overlay approach is the final architecture.

Eventually we want to support things like:

```text
Select existing PDF text
        ↓
Modify text
        ↓
Preserve surrounding layout
```

Potential future architecture:

```text
PDF
 │
 ├── Original content
 │
 ├── Parsed PDF objects
 │    ├── Text
 │    ├── Images
 │    ├── Shapes
 │    └── Paths
 │
 └── Editor objects
```

The current editor should not depend on the PDF being editable.

Keep the editor object model generic enough that later we can have:

```ts
type DocumentObject = OriginalPdfObject | EditorObject;
```

without rewriting the entire UI.

---

# Development process

Do not try to build everything in one giant implementation.

Build incrementally.

### Phase 1

Build:

- App shell
- PDF upload
- PDF.js rendering
- Page navigation
- Zoom
- Editor canvas
- Coordinate system

Make sure the PDF renders correctly before adding editing tools.

### Phase 2

Build:

- Selection
- Dragging
- Resizing
- Delete
- Undo/redo

Test these thoroughly.

### Phase 3

Build:

- Text
- Images
- Drawing
- Signature
- Highlight
- Shapes

### Phase 4

Build:

- Page management
- Export
- PDF generation

### Phase 5

Polish:

- Keyboard shortcuts
- Loading states
- Error states
- Performance
- Empty states
- UI polish

---

# Testing

Write tests for the important non-visual logic.

Especially:

- Coordinate conversions
- Object transformations
- History/undo/redo
- Page ordering
- PDF export calculations

Do not rely entirely on manual testing.

---

# Coding principles

Follow these rules throughout the implementation:

- TypeScript strict mode.
- No `any`.
- No unnecessary abstractions.
- No giant components.
- No duplicated coordinate logic.
- No PDF manipulation inside UI components.
- No business logic buried in JSX.
- Keep PDF rendering separate from editing.
- Keep editor state independent from PDF.js.
- Keep export logic independent from React.
- Prefer existing project utilities and conventions.
- Reuse existing components when available.
- Do not install a dependency if the existing stack can reasonably handle the problem.

Before adding a library, check whether the functionality can be implemented cleanly with the existing dependencies.

---

# Definition of done

The MVP is complete when a user can:

1. Open the application.
2. Upload a real PDF.
3. See its pages.
4. Select a page.
5. Zoom in/out.
6. Add text.
7. Edit the text.
8. Move and resize the text.
9. Add an image.
10. Draw on the page.
11. Create and place a signature.
12. Highlight an area.
13. Add shapes.
14. Undo and redo changes.
15. Reorder/delete pages.
16. Export the result.
17. Open the exported PDF in another PDF viewer and see all edits correctly positioned.

Most importantly:

**The exported PDF must visually match what the user saw in the editor.**

Start by inspecting the existing repository and its conventions. Do not rewrite existing infrastructure unnecessarily.

Then implement Phase 1 first and verify it works before moving to Phase 2.
