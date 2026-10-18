import { pageDocId } from "@/lib/editor/page-source";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import type { EditorDocument, PdfLinkAction } from "@/lib/editor/types";

export const resolvePdfLinkNavigation = (
  action: PdfLinkAction,
  document: EditorDocument,
  currentPageId?: string | null
): { kind: "url"; url: string } | { kind: "page"; pageId: string } | null => {
  switch (action.kind) {
    case "url": {
      return { kind: "url", url: action.url };
    }
    case "goto": {
      // Resolved at load to a page of the link's own source document.
      if (action.pageIndex === undefined) {
        return null;
      }
      const from = document.pages.find((page) => page.id === currentPageId);
      const docId = from ? pageDocId(from) : PRIMARY_DOC_ID;
      const page = document.pages.find(
        (item) =>
          item.sourceIndex === action.pageIndex && pageDocId(item) === docId
      );
      return page ? { kind: "page", pageId: page.id } : null;
    }
    case "named": {
      if (action.name === "NextPage" && currentPageId) {
        const currentIndex = document.pages.findIndex(
          (page) => page.id === currentPageId
        );
        const next =
          currentIndex === -1 ? undefined : document.pages[currentIndex + 1];
        if (next) {
          return { kind: "page", pageId: next.id };
        }
      }
      return null;
    }
    default: {
      return null;
    }
  }
};

export const activatePdfLinkAction = (
  action: PdfLinkAction,
  document: EditorDocument,
  navigateToPage: (pageId: string) => void,
  currentPageId?: string | null
): boolean => {
  const target = resolvePdfLinkNavigation(action, document, currentPageId);
  if (!target) {
    return false;
  }
  if (target.kind === "url") {
    window.open(target.url, "_blank", "noopener,noreferrer");
    return true;
  }
  navigateToPage(target.pageId);
  return true;
};
