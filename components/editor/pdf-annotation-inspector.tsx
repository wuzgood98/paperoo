"use client";

import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { ColorField } from "@/components/editor/color-field";
import { inspectorStripClassName } from "@/components/editor/inspector-strip";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  isPdfMarkupAnnotation,
  pdfLinkActionsEqual,
  pdfLinkEditableLabel,
} from "@/lib/editor/object-utils";
import { editorStore, useEditorStore } from "@/lib/editor/store";
import type {
  EditorPage,
  PdfAnnotationObject,
  PdfLinkAnnotation,
  PdfMarkupAnnotation,
} from "@/lib/editor/types";
import { sampleLinkCaptionFromPage } from "@/lib/pdf/sample-link-caption-from-page";

const isOpenableHttpUrl = (url: string): boolean =>
  url.startsWith("http://") || url.startsWith("https://");

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
      <div className="flex min-w-40 items-center gap-2 max-md:max-w-full max-md:min-w-0">
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
  const fieldId = useId();
  const labelInputId = `${fieldId}-label`;
  const urlInputId = `${fieldId}-url`;
  const skipCommitRef = useRef(false);
  const zoom = useEditorStore((state) => state.zoom);
  const {
    editable,
    label: derivedLabel,
    runs,
  } = pdfLinkEditableLabel(page, object);
  const urlValue = object.action.kind === "url" ? object.action.url : "";
  const labelValue = editable ? derivedLabel : object.label;
  const [focusedField, setFocusedField] = useState<"label" | "url" | null>(
    null
  );
  const [draft, setDraft] = useState("");
  const openHref = isOpenableHttpUrl(urlValue) ? urlValue : null;

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
    const [primary] = runs;
    if (!primary) {
      editorStore.commitPdfLinkLabel(trimmed);
      return;
    }
    void (async () => {
      const sampled = await sampleLinkCaptionFromPage(page, primary, zoom);
      editorStore.commitPdfLinkLabel(trimmed, sampled);
    })();
  };

  const blurField = (commit: () => void): void => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setFocusedField(null);
      return;
    }
    commit();
    setFocusedField(null);
  };

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      skipCommitRef.current = true;
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
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
    <div className="border-border bg-background border-b px-3 py-2 max-md:overflow-x-auto max-md:overscroll-x-contain">
      <form
        className="flex max-w-lg min-w-0 flex-col gap-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-pretty">Edit Link</h2>
          {openHref ? (
            <Button
              variant="link"
              render={
                <Link
                  href={openHref}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLinkIcon className="h-4 w-4" />
              Open Link
            </Button>
          ) : null}
        </div>
        <Field className="w-full min-w-0">
          <FieldLabel htmlFor={labelInputId}>Label</FieldLabel>
          {editable ? (
            <Input
              autoComplete="off"
              className="w-full min-w-0"
              id={labelInputId}
              name="label"
              onBlur={() => {
                blurField(commitLabel);
              }}
              onFocus={() => {
                setFocusedField("label");
                setDraft(labelValue);
              }}
              onValueChange={(value) => setDraft(value ?? "")}
              onKeyDown={onFieldKeyDown}
              placeholder="Link label…"
              value={focusedField === "label" ? draft : labelValue}
            />
          ) : (
            <>
              {labelValue ? (
                <p className="text-foreground min-w-0 truncate text-sm">
                  {labelValue}
                </p>
              ) : null}
              <FieldDescription>
                No editable text under this link.
              </FieldDescription>
            </>
          )}
        </Field>
        {object.action.kind === "url" ? (
          <Field className="w-full min-w-0">
            <FieldLabel htmlFor={urlInputId}>URL</FieldLabel>
            <Input
              autoComplete="off"
              className="w-full min-w-0"
              id={urlInputId}
              inputMode="url"
              name="url"
              onBlur={() => {
                blurField(commitUrl);
              }}
              onFocus={() => {
                setFocusedField("url");
                setDraft(urlValue);
              }}
              onValueChange={(value) => setDraft(value ?? "")}
              onKeyDown={onFieldKeyDown}
              placeholder="https://…"
              spellCheck={false}
              translate="no"
              type="url"
              value={focusedField === "url" ? draft : urlValue}
            />
          </Field>
        ) : (
          <p className="text-muted-foreground min-w-0 truncate text-sm">
            {nonUrlSummary()}
          </p>
        )}
      </form>
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
      <div className={inspectorStripClassName}>
        <MarkupInspector object={object} />
      </div>
    );
  }
  if (object.type === "pdf-free-text") {
    return (
      <div className={inspectorStripClassName}>
        <Textarea
          className="min-h-8 min-w-48 flex-1 max-md:max-w-full max-md:min-w-0"
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
      <div className={inspectorStripClassName}>
        <Textarea
          className="min-h-8 min-w-64 flex-1 max-md:max-w-full max-md:min-w-0"
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
