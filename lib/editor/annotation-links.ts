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
      const { dest } = action;
      if (!Array.isArray(dest) || dest.length === 0) {
        return null;
      }
      const [pageRef] = dest;
      if (pageRef && pageRef !== null && "num" in pageRef) {
        // SAFETY: PDF.js encodes explicit destinations with { num, gen } page refs.
        const num = Number((pageRef as { num: unknown }).num);
        if (!Number.isFinite(num)) {
          return null;
        }
        const page = document.pages.find(
          (item) => item.sourceIndex + 1 === num
        );
        if (page) {
          return { kind: "page", pageId: page.id };
        }
      }
      return null;
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
