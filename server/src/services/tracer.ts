import { createRequire } from "node:module";

// The tracing/vectorizing pipeline lives in the framework-agnostic CommonJS
// modules under api/, so the local Express server and the Vercel function share
// exactly one implementation. Load them via CommonJS interop.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { traceImageToSvg }: any = require("../../../api/_tracer.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { imageToTechnicalSvg }: any = require("../../../api/_technical.js");

export type TraceMode = "technical" | "line" | "edge" | "silhouette";

export interface TraceResult {
  svg: string;
  retried: boolean;
  model: string;
  rawLength: number;
}

/**
 * Vectorize an image into a clean SVG.
 *   - "technical" (default): centerline line drawing, auto line/edge extraction
 *   - "line" / "edge": technical drawing forcing the extraction method
 *   - "silhouette": filled potrace trace
 */
export async function generateSvgFromImage(options: {
  imageBase64: string;
  mimeType: string;
  mode?: TraceMode;
}): Promise<TraceResult> {
  const mode = options.mode ?? "technical";
  const result =
    mode === "silhouette"
      ? await traceImageToSvg(options.imageBase64, options.mimeType)
      : await imageToTechnicalSvg(options.imageBase64, options.mimeType, {
          mode: mode === "technical" ? "auto" : mode,
        });

  return {
    svg: result.svg,
    retried: false,
    model: result.meta.engine,
    rawLength: result.svg.length,
  };
}
