import { pageKeyOf, pageKeyString } from "@/lib/editor/page-source";
import { editorStore } from "@/lib/editor/store";
import { PRIMARY_DOC_ID } from "@/lib/editor/types";
import type { EditorDocument } from "@/lib/editor/types";
import {
  documentHasRedactions,
  pageHasRedactions,
} from "@/lib/pdf/output-pages";
import { pdfSession } from "@/lib/pdf/session";

export interface RedactionPrompt {
  /** A redacted page also appears unredacted (a duplicate). */
  unredactedCopies: boolean;
}

let prompt: RedactionPrompt | null = null;
let answer: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();
/** Opened files whose redactions the user has already confirmed. */
const confirmedFiles = new WeakSet<Uint8Array>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeRedactionPrompt = (
  listener: () => void
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const redactionPrompt = (): RedactionPrompt | null => prompt;

/** Close the prompt with the user's choice. */
export const answerRedactionPrompt = (confirmed: boolean): void => {
  const file = pdfSession.bytesOf(PRIMARY_DOC_ID);
  if (confirmed && file) {
    confirmedFiles.add(file);
  }
  const resolve = answer;
  prompt = null;
  answer = null;
  emit();
  resolve?.(confirmed);
};

/** Whether a redacted page's source page also shows without redactions. */
export const hasUnredactedCopies = (document: EditorDocument): boolean => {
  const redacted = new Set<string>();
  const plain = new Set<string>();
  for (const page of document.pages) {
    const key = pageKeyString(pageKeyOf(page));
    (pageHasRedactions(page) ? redacted : plain).add(key);
  }
  return [...redacted].some((key) => plain.has(key));
};

/**
 * Before export, extract or print: a document with redactions asks once
 * that the user means it, since the content under the boxes is gone from
 * the file for good. Resolves true to go ahead.
 */
export const confirmRedactions = (): Promise<boolean> => {
  const { document } = editorStore.getState();
  const file = pdfSession.bytesOf(PRIMARY_DOC_ID);
  if (!documentHasRedactions(document) || (file && confirmedFiles.has(file))) {
    return Promise.resolve(true);
  }
  // A second request while the prompt is open replaces the first.
  answer?.(false);
  prompt = { unredactedCopies: hasUnredactedCopies(document) };
  // oxlint-disable-next-line promise/avoid-new -- settled by the dialog's buttons
  const decided = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  emit();
  return decided;
};
