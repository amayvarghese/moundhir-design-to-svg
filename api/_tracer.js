/**
 * Deterministic sketch → SVG tracer.
 *
 * Instead of asking a language model to *guess* SVG coordinates (which produces
 * crude, unfaithful output), we vectorize the pixels directly with potrace — the
 * same tracing engine Inkscape uses. sharp cleans up the photo first (deskew of
 * lighting via normalize, contrast boost, despeckle) so the trace hugs the ink.
 *
 * The result is crisp, editable vector geometry that matches the uploaded image.
 */
const sharp = require("sharp");
const potrace = require("potrace");
const { optimize } = require("svgo");
const { XMLParser, XMLValidator } = require("fast-xml-parser");

const TARGET = {
  widthAttr: "1.5m",
  heightAttr: "3m",
  viewBox: "0 0 1500 3000",
  widthMm: 1500,
  heightMm: 3000,
  widthMeters: 1.5,
  heightMeters: 3,
  paddingRatio: 0.05,
};

/** Longest edge (px) we trace at. Big enough for detail, small enough to be fast. */
const TRACE_MAX_DIM = 1400;

/** Compute an Otsu (maximum between-class variance) threshold from an 8-bit histogram. */
function otsuThreshold(gray) {
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
 * Clean the source photo into a clean 1-bit black-on-white bitmap so potrace
 * traces the ink — never the paper. Returns a PNG buffer plus its dimensions.
 *
 * Robustness comes from three steps:
 *   1. sharp normalizes contrast + despeckles (handles dim, noisy phone photos),
 *   2. an Otsu threshold binarizes ink vs. paper adaptively per image, and
 *   3. a polarity guard flips the image if the dark region is the majority, so
 *      the drawing (not the background) is always what gets vectorized.
 */
async function preprocess(imageBase64, mimeType) {
  const input = Buffer.from(imageBase64, "base64");
  const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
  const srcW = meta.width || TRACE_MAX_DIM;
  const srcH = meta.height || TRACE_MAX_DIM;
  const scale = Math.min(1, TRACE_MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  // Grayscale, contrast-stretched, despeckled — as a raw single-channel buffer.
  const cleaned = sharp(input, { failOn: "none" })
    .rotate()
    .resize(w, h, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }) // transparent PNGs trace as white paper
    .grayscale()
    .normalize()
    .median(2);

  const { data: gray, info } = await cleaned
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const threshold = otsuThreshold(gray);

  // Fraction of pixels darker than the threshold. Line art is mostly paper, so
  // if the dark side is the majority the photo is inverted — flip it.
  let dark = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] < threshold) dark++;
  const inkIsMajority = dark / gray.length > 0.5;

  // threshold(): >= t → white (255), < t → black (0). Ink ends up black.
  let binary = cleaned.threshold(threshold);
  if (inkIsMajority) binary = binary.negate();

  const png = await binary.png().toBuffer();
  return { buffer: png, width: info.width, height: info.height, mimeType };
}

/** Run potrace on a prepared 1-bit buffer and resolve with its raw SVG string. */
function tracePng(buffer) {
  return new Promise((resolve, reject) => {
    const tracer = new potrace.Potrace({
      threshold: 128, // image is already binarized; split cleanly at the midpoint
      turdSize: 3, // drop specks smaller than this (px area) — keeps it "very clear"
      turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY,
      alphaMax: 1, // smoothness of corners
      optCurve: true,
      optTolerance: 0.2,
      color: "#111111",
      background: "transparent",
    });
    tracer.loadImage(buffer, (err) => {
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

function parseViewBox(svg) {
  const m = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (m) {
    const parts = m[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
    }
  }
  return null;
}

/** Fit traced geometry, centered with margin, into the fixed 1.5 m × 3 m canvas. */
function applyTargetCanvas(svg, srcDims) {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open || open.index === undefined) return svg;
  const openEnd = open.index + open[0].length;
  const closeIdx = svg.toLowerCase().lastIndexOf("</svg>");
  if (closeIdx === -1) return svg;

  const inner = svg.slice(openEnd, closeIdx).trim();
  const source =
    parseViewBox(svg) ||
    (srcDims
      ? { minX: 0, minY: 0, width: srcDims.width, height: srcDims.height }
      : { minX: 0, minY: 0, width: TARGET.widthMm, height: TARGET.heightMm });

  const availW = TARGET.widthMm * (1 - 2 * TARGET.paddingRatio);
  const availH = TARGET.heightMm * (1 - 2 * TARGET.paddingRatio);
  const scale = Math.min(availW / source.width, availH / source.height);
  const scaledW = source.width * scale;
  const scaledH = source.height * scale;
  const tx = (TARGET.widthMm - scaledW) / 2 - source.minX * scale;
  const ty = (TARGET.heightMm - scaledH) / 2 - source.minY * scale;
  const r = (n) => Math.round(n * 10000) / 10000;
  const body = `<g data-sketch2svg-fit="1" transform="translate(${r(tx)} ${r(ty)}) scale(${r(scale)})">${inner}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET.widthAttr}" height="${TARGET.heightAttr}" viewBox="${TARGET.viewBox}" data-sketch2svg-canvas="1.5x3" data-physical-size="1.5 m × 3 m">${body}</svg>`;
}

function isValidSvg(svg) {
  try {
    if (XMLValidator.validate(svg, { allowBooleanAttributes: true }) !== true) {
      return false;
    }
    const parsed = new XMLParser({
      ignoreAttributes: false,
      preserveOrder: true,
    }).parse(svg);
    return (
      Array.isArray(parsed) &&
      parsed.some((n) => n && typeof n === "object" && "svg" in n)
    );
  } catch {
    return false;
  }
}

function optimizeSvg(svg) {
  try {
    return optimize(svg, {
      multipass: true,
      plugins: [
        {
          name: "preset-default",
          params: {
            // Keep geometry faithful. removeViewBox is not in preset-default (v4),
            // so the viewBox is preserved automatically.
            overrides: { cleanupIds: false },
          },
        },
      ],
    }).data;
  } catch {
    return svg;
  }
}

/**
 * Full pipeline: base64 image in → clean, canvas-fitted SVG out.
 * @returns {Promise<{ svg: string, meta: object }>}
 */
async function traceImageToSvg(imageBase64, mimeType) {
  const started = Date.now();
  const prepared = await preprocess(imageBase64, mimeType);
  const rawSvg = await tracePng(prepared.buffer);

  if (!/<path\b/i.test(rawSvg)) {
    throw new Error(
      "No shapes detected in the image. Use a clearer photo of the drawing with good contrast.",
    );
  }

  const optimized = optimizeSvg(rawSvg);
  let canvased = applyTargetCanvas(optimized, prepared);
  if (!isValidSvg(canvased)) {
    canvased = applyTargetCanvas(rawSvg, prepared);
    if (!isValidSvg(canvased)) {
      throw new Error("Traced SVG failed validation");
    }
  }

  return {
    svg: canvased,
    meta: {
      elapsedMs: Date.now() - started,
      engine: "potrace",
      sourceWidth: prepared.width,
      sourceHeight: prepared.height,
      width: TARGET.widthMm,
      height: TARGET.heightMm,
      widthMeters: TARGET.widthMeters,
      heightMeters: TARGET.heightMeters,
      physicalSize: "1.5 m × 3 m",
      unit: "m",
      viewBox: TARGET.viewBox,
    },
  };
}

module.exports = { traceImageToSvg, TARGET };
