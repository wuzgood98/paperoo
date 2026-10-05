"use client";

import { useState } from "react";

import { ColorField } from "@/components/editor/color-field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  isPdfMarkupAnnotation,
  pdfLinkActionsEqual,
  pdfLinkEditableLabel,
} from "@/lib/editor/object-utils";
import { editorStore } from "@/lib/editor/store";
import type {
  EditorPage,
  PdfAnnotationObject,
  PdfLinkAnnotation,
  PdfMarkupAnnotation,
} from "@/lib/editor/types";

const MarkupInspector = ({ object }: { object: PdfMarkupAnnotation }) => (
  <div className="flex flex-wrap items-center gap-3">
    <ColorField
      label="Color"
      onChange={(color) =>
        editorStore.patchPdfAnnotation((current) =>
          current.id === object.id && isPdfMarkupAnnotation(current)
            ? { ...current, color }
            : current
        )
      }
      value={object.color}
    />
    {object.type === "pdf-highlight" ? (
      <div className="flex min-w-40 items-center gap-2">
        <span className="text-muted-foreground text-xs">Opacity</span>
        <Slider
          max={1}
          min={0.1}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (next === undefined) {
              return;
            }
            editorStore.patchPdfAnnotation((current) =>
              current.id === object.id && current.type === "pdf-highlight"
                ? { ...current, opacity: next }
                : current
            );
          }}
          step={0.05}
          value={[object.opacity ?? 1]}
        />
      </div>
    ) : null}
  </div>
);

const LinkInspector = ({
  object,
  page,
}: {
  object: PdfLinkAnnotation;
  page: EditorPage;
}) => {
  const { editable, label: derivedLabel } = pdfLinkEditableLabel(page, object);
  const urlValue = object.action.kind === "url" ? object.action.url : "";
  const labelValue = editable ? derivedLabel : object.label;
  const [focusedField, setFocusedField] = useState<"label" | "url" | null>(
    null
  );
  const [draft, setDraft] = useState("");

  const commitUrl = (): void => {
    const trimmed = draft.trim();
    if (!trimmed || object.action.kind !== "url") {
      return;
    }
    const next = { kind: "url" as const, url: trimmed };
    if (pdfLinkActionsEqual(object.action, next)) {
      return;
    }
    editorStore.patchPdfAnnotation((current) =>
      current.id === object.id && current.type === "pdf-link"
        ? { ...current, action: next }
        : current
    );
  };

  const commitLabel = (): void => {
    if (!editable) {
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === derivedLabel) {
      return;
    }
    editorStore.commitPdfLinkLabel(trimmed);
  };

  const nonUrlSummary = (): string => {
    if (object.action.kind === "named") {
      return object.action.name;
    }
    if (object.action.kind === "goto") {
      return "Internal link";
    }
    return "Link";
  };

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
      <span className="text-muted-foreground shrink-0">PDF link</span>
      {object.action.kind === "url" ? (
        <Input
          className="min-w-48 flex-1"
          onBlur={() => {
            commitUrl();
            setFocusedField(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            setFocusedField("url");
            setDraft(urlValue);
          }}
          placeholder="https://"
          value={focusedField === "url" ? draft : urlValue}
        />
      ) : (
        <span className="text-muted-foreground max-w-md truncate">
          {nonUrlSummary()}
        </span>
      )}
      <Textarea
        className="min-h-8 min-w-40 flex-1"
        disabled={!editable}
        onBlur={() => {
          commitLabel();
          setFocusedField(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.currentTarget.blur();
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          setFocusedField("label");
          setDraft(labelValue);
        }}
        placeholder={editable ? "Visible label" : "No editable text under link"}
        rows={1}
        value={focusedField === "label" ? draft : labelValue}
      />
    </div>
  );
};

export const PdfAnnotationInspector = ({
  object,
  page,
}: {
  object: PdfAnnotationObject;
  page: EditorPage;
}) => {
  if (object.type === "pdf-link") {
    return <LinkInspector object={object} page={page} />;
  }
  if (isPdfMarkupAnnotation(object)) {
    return (
      <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <MarkupInspector object={object} />
      </div>
    );
  }
  if (object.type === "pdf-free-text") {
    return (
      <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <Textarea
          className="min-h-8 min-w-48 flex-1"
          onChange={(event) =>
            editorStore.patchPdfAnnotation((current) =>
              current.id === object.id && current.type === "pdf-free-text"
                ? { ...current, contents: event.target.value }
                : current
            )
          }
          rows={2}
          value={object.contents}
        />
        <ColorField
          label="Color"
          onChange={(color) =>
            editorStore.patchPdfAnnotation((current) =>
              current.id === object.id && current.type === "pdf-free-text"
                ? { ...current, color, fontColor: color }
                : current
            )
          }
          value={object.fontColor}
        />
        <Input
          className="w-20"
          min={6}
          onChange={(event) => {
            const fontSize = Number(event.target.value);
            if (!Number.isFinite(fontSize)) {
              return;
            }
            editorStore.patchPdfAnnotation((current) =>
              current.id === object.id && current.type === "pdf-free-text"
                ? { ...current, fontSize }
                : current
            );
          }}
          type="number"
          value={object.fontSize}
        />
      </div>
    );
  }
  if (object.type === "pdf-text-note") {
    return (
      <div className="border-border bg-background flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <Textarea
          className="min-h-8 min-w-64 flex-1"
          onChange={(event) =>
            editorStore.patchPdfAnnotation((current) =>
              current.id === object.id && current.type === "pdf-text-note"
                ? { ...current, contents: event.target.value }
                : current
            )
          }
          rows={3}
          value={object.contents}
        />
      </div>
    );
  }
  if (object.type === "pdf-stamp") {
    return (
      <div className="border-border bg-background flex items-center gap-3 border-b px-3 py-2 text-sm">
        <span className="text-muted-foreground">PDF stamp</span>
      </div>
    );
  }
  return null;
};
