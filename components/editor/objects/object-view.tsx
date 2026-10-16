"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { editorStore } from "@/lib/editor/store";
import type { EditorObject, TextObject } from "@/lib/editor/types";
import { fontFamilyCss } from "@/lib/fonts/measure-text";

const placeCaretAtEnd = (node: HTMLElement): void => {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const TextObjectView = ({
  editing,
  object,
  onTextCommit,
  zoom,
}: {
  editing: boolean;
  object: TextObject;
  onTextCommit?: (content: string) => void;
  zoom: number;
}) => {
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = textRef.current;
    if (editing && node) {
      node.focus({ preventScroll: true });
      placeCaretAtEnd(node);
    }
  }, [editing]);

  return (
    <div className="relative h-full w-full">
      {object.ocrWordId ? (
        <div aria-hidden className="absolute inset-0 bg-white" />
      ) : null}
      <div
        className="relative h-full w-full overflow-hidden break-words whitespace-pre-wrap outline-none empty:before:opacity-40 empty:before:content-['Text']"
        contentEditable={editing}
        onBlur={(event) => {
          if (!editing) {
            return;
          }
          onTextCommit?.(event.currentTarget.textContent);
        }}
        onPointerDown={(event) => {
          if (editing) {
            event.stopPropagation();
          }
        }}
        ref={textRef}
        style={{
          color: object.color,
          fontFamily: fontFamilyCss(object.fontFamily),
          fontSize: object.fontSize * zoom,
          fontStyle: object.italic ? "italic" : "normal",
          fontWeight: object.fontWeight,
          lineHeight: 1.2,
          textAlign: object.align,
        }}
        suppressContentEditableWarning
      >
        {object.content}
      </div>
    </div>
  );
};

export const ObjectView = ({
  editing,
  object,
  onTextCommit,
  zoom,
}: {
  editing: boolean;
  object: EditorObject;
  onTextCommit?: (content: string) => void;
  zoom: number;
}) => {
  switch (object.type) {
    case "text": {
      return (
        <TextObjectView
          editing={editing}
          object={object}
          onTextCommit={onTextCommit}
          zoom={zoom}
        />
      );
    }
    case "image": {
      const asset = editorStore.getAsset(object.assetId);
      if (!asset) {
        return <div className="bg-muted h-full w-full" />;
      }
      return (
        <div className="relative h-full w-full">
          <Image
            alt=""
            className="pointer-events-none object-fill [-webkit-user-drag:none]"
            draggable={false}
            fill
            onDragStart={(event) => {
              event.preventDefault();
            }}
            sizes="400px"
            src={asset.objectUrl}
            unoptimized
          />
        </div>
      );
    }
    case "drawing":
    case "signature": {
      return (
        <svg
          className="h-full w-full overflow-hidden"
          preserveAspectRatio="none"
          viewBox={`0 0 ${object.width} ${object.height}`}
        >
          <path
            d={object.points
              .map(
                (point, index) =>
                  `${index === 0 ? "M" : "L"}${point.x} ${point.y}`
              )
              .join(" ")}
            fill="none"
            stroke={object.stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={object.strokeWidth}
          />
        </svg>
      );
    }
    case "highlight": {
      return (
        <div
          className="h-full w-full"
          style={{ backgroundColor: object.color }}
        />
      );
    }
    case "shape": {
      if (object.shape === "circle") {
        return (
          <svg
            className="h-full w-full overflow-hidden"
            preserveAspectRatio="none"
            viewBox={`0 0 ${object.width} ${object.height}`}
          >
            <ellipse
              cx={object.width / 2}
              cy={object.height / 2}
              fill={object.fill ?? "none"}
              rx={object.width / 2}
              ry={object.height / 2}
              stroke={object.stroke}
              strokeWidth={object.strokeWidth}
            />
          </svg>
        );
      }
      if (object.shape === "line") {
        return (
          <svg
            className="h-full w-full overflow-hidden"
            preserveAspectRatio="none"
            viewBox={`0 0 ${object.width} ${object.height}`}
          >
            <line
              stroke={object.stroke}
              strokeWidth={object.strokeWidth}
              x1={0}
              x2={object.width}
              y1={0}
              y2={object.height}
            />
          </svg>
        );
      }
      return (
        <div
          className="h-full w-full"
          style={{
            backgroundColor: object.fill ?? "transparent",
            border: `${object.strokeWidth * zoom}px solid ${object.stroke}`,
          }}
        />
      );
    }
    default: {
      const _exhaustive: never = object;
      return _exhaustive;
    }
  }
};
