import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import type { EditorPage } from "@/lib/editor/types";

/** A page of a source document: which document, and which page in it. */
export interface PageKey {
  docId: string;
  sourceIndex: number;
}

/** The source document a page comes from. */
export const pageDocId = (page: Pick<EditorPage, "docId">): string =>
  page.docId ?? PRIMARY_DOC_ID;

export const pageKeyOf = (
  page: Pick<EditorPage, "docId" | "sourceIndex">
): PageKey => ({ docId: pageDocId(page), sourceIndex: page.sourceIndex });

/** One string per source page, for maps and caches. */
export const pageKeyString = ({ docId, sourceIndex }: PageKey): string =>
  `${docId}#${sourceIndex}`;
