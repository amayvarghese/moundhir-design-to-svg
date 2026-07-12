import { createRequire } from "node:module";

// The tracing/vectorizing pipeline lives in the framework-agnostic CommonJS
// modules under api/, so the local Express server and the Vercel function share
// exactly one implementation. Load them via CommonJS interop.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { traceImageToSvg }: any = require("../../../api/_tracer.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { imageToTechnicalSvg }: any = require("../../../api/_technical.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { generateSvgWithGroq }: any = require("../../../api/_groq.js");

export type TraceMode = "ai" | "technical" | "line" | "edge" | "silhouette";

export interface TraceResult {
  svg: string;
  retried: boolean;
  model: string;
  rawLength: number;
}

/**
 * Turn an image into a clean SVG.
 *   - "ai" (default): a Groq vision model redraws it as clean, professional shapes
 *   - "technical": deterministic centerline geometry (auto line/edge)
 *   - "line" / "edge": technical, forcing the extraction method
 *   - "silhouette": filled potrace trace
 */
export async function generateSvgFromImage(options: {
  imageBase64: string;
  mimeType: string;
  mode?: TraceMode;
}): Promise<TraceResult> {
  const mode = options.mode ?? "ai";
  const { imageBase64, mimeType } = options;

  const technical = () =>
    imageToTechnicalSvg(imageBase64, mimeType, {
      mode: mode === "technical" || mode === "ai" ? "auto" : mode,
    });

  let result;
  if (mode === "ai") {
    try {
      result = await generateSvgWithGroq(imageBase64, mimeType, {});
    } catch (aiError) {
      console.warn(
        "[generate-svg] AI fallback:",
        aiError instanceof Error ? aiError.message : aiError,
      );
      result = await technical();
    }
  } else if (mode === "silhouette") {
    result = await traceImageToSvg(imageBase64, mimeType);
  } else {
    result = await technical();
  }

  return {
    svg: result.svg,
    retried: false,
    model: result.meta.model || result.meta.engine,
    rawLength: result.svg.length,
  };
}
