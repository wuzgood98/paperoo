import { PDFDocument, StandardFonts } from "pdf-lib";

import type { EditorPage, PdfTextObject } from "@/lib/editor/types";

/** A page with "Old line" above "Keep line", both in Helvetica. */
export const twoLinePdf = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Old line", { font, size: 14, x: 72, y: 700 });
  page.drawText("Keep line", { font, size: 14, x: 72, y: 660 });
  return doc.save();
};

/** What the browser measures before export (Node has no canvas). */
export const withCover = (run: PdfTextObject): PdfTextObject => ({
  ...run,
  coverRects: [{ height: run.height, width: run.width, x: run.x, y: run.y }],
});

export const editRun = (
  page: EditorPage,
  original: string,
  text: string,
  patch: Partial<PdfTextObject> = {}
): EditorPage => ({
  ...page,
  pdfTextObjects: page.pdfTextObjects.map((run) =>
    run.originalText === original ? { ...withCover(run), text, ...patch } : run
  ),
});
