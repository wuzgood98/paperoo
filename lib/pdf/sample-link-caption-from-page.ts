import {
  displayedCanvasRotation,
  pdfTextBaselineDisplayed,
} from "@/lib/editor/coordinates";
import {
  measurePdfTextWidth,
  pdfTextOverlayBox,
} from "@/lib/editor/object-utils";
import type { EditorPage, PdfTextObject } from "@/lib/editor/types";
import { renderPdfPageRegion } from "@/lib/pdf/render-page";
import { sampleCaptionInk } from "@/lib/pdf/sample-caption-ink";
import type { SampledCaptionInk } from "@/lib/pdf/sample-caption-ink";
import { pdfSession } from "@/lib/pdf/session";

/**
 * Pixels per point for sampling. Fixed, not the view zoom: at 87% a 1 pt rule
 * is barely one pixel and its center can land half a point too high.
 */
const CAPTION_SAMPLE_SCALE = 8;
/** How far below the baseline to look for the rule, in ems. */
const UNDERLINE_SEARCH_EM = 0.5;

/** Read caption fill and underline from the original page before a label edit. */
export const sampleLinkCaptionFromPage = async (
  page: EditorPage,
  primary: PdfTextObject
): Promise<SampledCaptionInk | null> => {
  const runBox = pdfTextOverlayBox(primary, measurePdfTextWidth(primary));
  const baseline = pdfTextBaselineDisplayed(
    primary.transform,
    page.cropBox,
    page.sourceRotate
  ).y;
  const fontSize = primary.fontSize ?? primary.height;
  // The run box ends at most 0.25em under the baseline; a rule can sit lower.
  const region = {
    height: Math.max(
      runBox.height,
      baseline - runBox.y + fontSize * UNDERLINE_SEARCH_EM
    ),
    width: runBox.width,
    x: runBox.x,
    y: runBox.y,
  };
  const pdfPage = await pdfSession.retainPage(page.sourceIndex);
  if (!pdfPage) {
    return null;
  }
  let canvas: HTMLCanvasElement;
  try {
    canvas = await renderPdfPageRegion(
      pdfPage,
      region,
      CAPTION_SAMPLE_SCALE,
      displayedCanvasRotation(page)
    );
  } finally {
    pdfSession.releasePageRef(page.sourceIndex);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const ink = sampleCaptionInk(
    { data: image.data, height: image.height, width: image.width },
    { height: image.height, width: image.width, x: 0, y: 0 },
    (baseline - region.y) * CAPTION_SAMPLE_SCALE
  );
  if (!ink) {
    return null;
  }
  if (!ink.underline) {
    return ink;
  }
  return {
    fill: ink.fill,
    underline: {
      color: ink.underline.color,
      offsetFromRunTop:
        region.y +
        ink.underline.offsetFromRunTop / CAPTION_SAMPLE_SCALE -
        primary.y,
      thickness: Math.max(0.5, ink.underline.thickness / CAPTION_SAMPLE_SCALE),
    },
  };
};
