import { userBoxToDisplayed } from "@/lib/editor/coordinates";
import { createId } from "@/lib/editor/ids";
import type {
  CropBox,
  PageRotation,
  PdfAnnotationObject,
  PdfLinkAction,
  PdfMarkupAnnotation,
  Rect,
} from "@/lib/editor/types";

export interface ExtractAnnotationPage {
  cropBox: CropBox;
  id: string;
  sourceRotate: PageRotation;
}

interface PdfJsAnnotation {
  annotationType?: number;
  color?: Uint8ClampedArray | null;
  contentsObj?: { str: string; dir: string } | null;
  defaultAppearanceData?: {
    fontColor?: Uint8ClampedArray;
    fontName?: string;
    fontSize?: number;
  } | null;
  dest?: unknown;
  id?: string;
  name?: string;
  opacity?: number;
  popupRef?: string | null;
  quadPoints?: Float32Array | null;
  rect?: number[] | null;
  rotation?: number;
  subtype?: string | null;
  url?: string | null;
  unsafeUrl?: string | null;
  action?: string | null;
  annotationFlags?: number;
  overlaidText?: string | null;
}

const DEFAULT_MARKUP_COLOR = "#facc15";
const DEFAULT_FREE_TEXT_COLOR = "#111827";
const DEFAULT_FREE_TEXT_SIZE = 12;
/** pdf.js ids for annotations stored as their own object: "12R" or "12R0". */
const OBJECT_REF_ID = /^\d+R\d*$/u;

export const rgbBytesToHex = (
  color: Uint8ClampedArray | null | undefined,
  fallback: string
): string => {
  if (!color || color.length < 3) {
    return fallback;
  }
  const r = color[0] ?? 0;
  const g = color[1] ?? 0;
  const b = color[2] ?? 0;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const userRectFromPdfRect = (rect: number[]): Rect => {
  const [x1, y1, x2, y2] = rect;
  return {
    height: Math.abs(y2 - y1),
    width: Math.abs(x2 - x1),
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
  } satisfies Rect;
};

const displayedRectFromUser = (user: Rect, page: ExtractAnnotationPage): Rect =>
  userBoxToDisplayed(user, page.cropBox, page.sourceRotate);

const quadsFromQuadPoints = (
  quadPoints: Float32Array,
  page: ExtractAnnotationPage
): Rect[] => {
  const quads: Rect[] = [];
  for (let i = 0; i + 7 < quadPoints.length; i += 8) {
    const xs = [
      quadPoints[i] ?? 0,
      quadPoints[i + 2] ?? 0,
      quadPoints[i + 4] ?? 0,
      quadPoints[i + 6] ?? 0,
    ];
    const ys = [
      quadPoints[i + 1] ?? 0,
      quadPoints[i + 3] ?? 0,
      quadPoints[i + 5] ?? 0,
      quadPoints[i + 7] ?? 0,
    ];
    const user: Rect = {
      height: Math.max(...ys) - Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      x: Math.min(...xs),
      y: Math.min(...ys),
    };
    quads.push(displayedRectFromUser(user, page));
  }
  return quads;
};

const flatQuadPointsUser = (quadPoints: Float32Array): number[] => [
  ...quadPoints,
];

const parseLinkAction = (raw: PdfJsAnnotation): PdfLinkAction => {
  const url = raw.url ?? raw.unsafeUrl;
  if (url && url.length > 0) {
    return { kind: "url", url };
  }
  if (raw.dest !== undefined && raw.dest !== null) {
    return { dest: raw.dest, kind: "goto" };
  }
  const namedAction = raw.action;
  if (namedAction && namedAction.length > 0) {
    return { kind: "named", name: namedAction };
  }
  return { kind: "none" };
};

const baseFields = (
  raw: PdfJsAnnotation,
  page: ExtractAnnotationPage,
  displayed: Rect,
  user: Rect
) => ({
  annotationFlags: raw.annotationFlags ?? 0,
  deleted: false,
  height: displayed.height,
  id: createId(),
  originalHeight: displayed.height,
  originalRotation: raw.rotation ?? 0,
  originalUserHeight: user.height,
  originalUserWidth: user.width,
  originalUserX: user.x,
  originalUserY: user.y,
  originalWidth: displayed.width,
  originalX: displayed.x,
  originalY: displayed.y,
  pageId: page.id,
  rotation: raw.rotation ?? 0,
  sourceRef: raw.id ?? "",
  subtype: raw.subtype ?? "Unknown",
  width: displayed.width,
  x: displayed.x,
  y: displayed.y,
});

export interface ExtractAnnotationsResult {
  objects: PdfAnnotationObject[];
  skippedSubtypes: string[];
}

const SUPPORTED = new Set([
  "Link",
  "Highlight",
  "Underline",
  "Squiggly",
  "StrikeOut",
  "FreeText",
  "Text",
  "Stamp",
]);

// oxlint-disable-next-line eslint/complexity -- subtype switch mirrors PDF annotation catalog.
export const extractPdfAnnotationObjects = (
  rawAnnotations: readonly PdfJsAnnotation[],
  page: ExtractAnnotationPage
): ExtractAnnotationsResult => {
  const objects: PdfAnnotationObject[] = [];
  const skipped = new Set<string>();

  for (const raw of rawAnnotations) {
    const subtype = raw.subtype ?? "Unknown";
    if (subtype === "Widget" || subtype === "Popup") {
      continue;
    }
    if (!SUPPORTED.has(subtype)) {
      skipped.add(subtype);
      continue;
    }
    // An annotation written inline in /Annots has no object ref (pdf.js
    // names it "annot_<n>"), so export could not find it to change or
    // remove it. It stays part of the page instead of looking editable.
    if (
      !(raw.id && OBJECT_REF_ID.test(raw.id)) ||
      !raw.rect ||
      raw.rect.length < 4
    ) {
      continue;
    }

    const user = userRectFromPdfRect(raw.rect);
    const displayed = displayedRectFromUser(user, page);
    const color = rgbBytesToHex(raw.color, DEFAULT_MARKUP_COLOR);
    const contents = raw.contentsObj?.str ?? "";
    const popupRef = raw.popupRef ?? null;

    switch (subtype) {
      case "Link": {
        const action = parseLinkAction(raw);
        const label = raw.overlaidText?.trim() ?? "";
        objects.push({
          ...baseFields(raw, page, displayed, user),
          action,
          color,
          label,
          originalAction: action,
          originalColor: color,
          originalLabel: label,
          originalUserQuadPoints: raw.quadPoints
            ? flatQuadPointsUser(raw.quadPoints)
            : null,
          quads: raw.quadPoints
            ? quadsFromQuadPoints(raw.quadPoints, page)
            : [displayed],
          type: "pdf-link",
        });
        break;
      }
      case "Highlight": {
        if (!raw.quadPoints) {
          break;
        }
        const quads = quadsFromQuadPoints(raw.quadPoints, page);
        const opacity =
          raw.opacity !== undefined && Number.isFinite(raw.opacity)
            ? raw.opacity
            : 1;
        objects.push({
          ...baseFields(raw, page, displayed, user),
          color,
          opacity,
          originalColor: color,
          originalOpacity: opacity,
          originalUserQuadPoints: flatQuadPointsUser(raw.quadPoints),
          popupRef,
          quads,
          type: "pdf-highlight",
        });
        break;
      }
      case "Underline":
      case "Squiggly":
      case "StrikeOut": {
        if (!raw.quadPoints) {
          break;
        }
        const quads = quadsFromQuadPoints(raw.quadPoints, page);
        let type: PdfMarkupAnnotation["type"] = "pdf-underline";
        if (subtype === "Squiggly") {
          type = "pdf-squiggly";
        } else if (subtype === "StrikeOut") {
          type = "pdf-strikeout";
        }
        objects.push({
          ...baseFields(raw, page, displayed, user),
          color,
          originalColor: color,
          originalUserQuadPoints: flatQuadPointsUser(raw.quadPoints),
          popupRef,
          quads,
          type,
        });
        break;
      }
      case "FreeText": {
        const da = raw.defaultAppearanceData;
        const fontColor = rgbBytesToHex(
          da?.fontColor ?? null,
          DEFAULT_FREE_TEXT_COLOR
        );
        const rawFontSize = da?.fontSize;
        const fontSize =
          rawFontSize !== undefined && rawFontSize > 0
            ? rawFontSize
            : DEFAULT_FREE_TEXT_SIZE;
        objects.push({
          ...baseFields(raw, page, displayed, user),
          color: fontColor,
          contents,
          fontColor,
          fontSize,
          originalColor: fontColor,
          originalContents: contents,
          originalFontSize: fontSize,
          popupRef,
          type: "pdf-free-text",
        });
        break;
      }
      case "Text": {
        objects.push({
          ...baseFields(raw, page, displayed, user),
          color,
          contents,
          iconName: raw.name ?? "Note",
          originalColor: color,
          originalContents: contents,
          originalIconName: raw.name ?? "Note",
          popupRef,
          type: "pdf-text-note",
        });
        break;
      }
      case "Stamp": {
        objects.push({
          ...baseFields(raw, page, displayed, user),
          appearanceTranslatable: Boolean(raw.id),
          color,
          originalColor: color,
          popupRef,
          type: "pdf-stamp",
        });
        break;
      }
      default: {
        skipped.add(subtype);
      }
    }
  }

  return {
    objects,
    skippedSubtypes: [...skipped],
  };
};
