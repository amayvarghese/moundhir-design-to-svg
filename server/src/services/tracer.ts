import { createRequire } from "node:module";
import sharp from "sharp";
import { sanitizeAndOptimize } from "./svg.js";

// potrace ships no type declarations; load it via CommonJS interop.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const potrace: any = require("potrace");

const TRACE_MAX_DIM = 1400;

export interface TraceResult {
  svg: string;
  retried: boolean;
  model: string;
  rawLength: number;
}

/** Otsu (maximum between-class variance) threshold from an 8-bit histogram. */
function otsuThreshold(gray: Buffer): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Clean the source photo into a 1-bit black-on-white bitmap: normalize + despeckle,
 * Otsu-threshold ink from paper, then flip polarity if the dark side is the majority
 * so potrace always vectorizes the drawing, never the background.
 */
async function preprocess(imageBase64: string): Promise<Buffer> {
  const input = Buffer.from(imageBase64, "base64");
  const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
  const srcW = meta.width ?? TRACE_MAX_DIM;
  const srcH = meta.height ?? TRACE_MAX_DIM;
  const scale = Math.min(1, TRACE_MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const cleaned = sharp(input, { failOn: "none" })
    .rotate()
    .resize(w, h, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalize()
    .median(2);

  const { data: gray } = await cleaned
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const threshold = otsuThreshold(gray);
  let dark = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] < threshold) dark++;
  const inkIsMajority = dark / gray.length > 0.5;

  let binary = cleaned.threshold(threshold);
  if (inkIsMajority) binary = binary.negate();
  return binary.png().toBuffer();
}

function tracePng(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const tracer = new potrace.Potrace({
      threshold: 128,
      turdSize: 3,
      turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY,
      alphaMax: 1,
      optCurve: true,
      optTolerance: 0.2,
      color: "#111111",
      background: "transparent",
    });
    tracer.loadImage(buffer, (err: Error | null) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      try {
        resolve(tracer.getSVG());
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/**
 * Vectorize a sketch image into a clean, canvas-fitted SVG with potrace.
 */
export async function generateSvgFromImage(options: {
  imageBase64: string;
  mimeType: string;
}): Promise<TraceResult> {
  const png = await preprocess(options.imageBase64);
  const rawSvg = await tracePng(png);
  if (!/<path\b/i.test(rawSvg)) {
    throw new Error(
      "No shapes detected in the image. Use a clearer photo of the drawing with good contrast.",
    );
  }
  const svg = sanitizeAndOptimize(rawSvg);
  return { svg, retried: false, model: "potrace", rawLength: rawSvg.length };
}
