/**
 * Technical line-drawing vectorizer.
 *
 * Turns an uploaded image into a clean, CAD-style line drawing made of single
 * centerline strokes (stroke-only paths, no fills) — the way a technical drawing
 * reads, rather than the filled silhouette potrace produces.
 *
 * Pipeline:
 *   1. sharp normalizes + resizes the image to grayscale.
 *   2. We extract a 1-px "line image":
 *        - line-art / sketch input → binarize the ink directly,
 *        - photo / continuous-tone input → Sobel edge detection of the contours.
 *      (auto-detected from ink coverage; overridable via mode).
 *   3. Zhang–Suen thinning reduces every line to a 1-px skeleton.
 *   4. The skeleton is walked into polylines, split at junctions and endpoints.
 *   5. Ramer–Douglas–Peucker simplifies each polyline into crisp segments.
 *   6. Polylines become stroke paths, centered + scaled into the 1.5 m × 3 m canvas.
 */
const sharp = require("sharp");
const {
  TARGET,
  otsuThreshold,
  applyTargetCanvas,
  optimizeSvg,
  isValidSvg,
} = require("./_tracer");

/** Longest edge (px) we vectorize at. Kept modest so thinning stays fast. */
const MAX_DIM = 1000;
/** Target on-canvas stroke thickness (in the 1500-unit-wide viewBox). */
const CANVAS_STROKE = 6;
/** RDP simplification tolerance, in source pixels. */
const SIMPLIFY_EPS = 1.4;
/** Drop traced polylines shorter than this many pixels (speckle removal). */
const MIN_LINE_LEN = 7;

async function toGray(imageBase64) {
  const input = Buffer.from(imageBase64, "base64");
  const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
  const srcW = meta.width || MAX_DIM;
  const srcH = meta.height || MAX_DIM;
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const { data } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(w, h, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalize()
    .toColourspace("b-w") // guarantee a single channel
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { gray: data, width: w, height: h };
}

/** Binarize dark ink → 1, paper → 0. Returns { bin, darkFraction, meanDark }. */
function binarizeInk(gray) {
  const t = otsuThreshold(gray);
  const bin = new Uint8Array(gray.length);
  let dark = 0;
  let sumDark = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < t) {
      bin[i] = 1;
      dark++;
      sumDark += gray[i];
    }
  }
  return {
    bin,
    darkFraction: dark / gray.length,
    meanDark: dark ? sumDark / dark : 255,
  };
}

/**
 * Sobel gradient magnitude → keep the strongest edges as 1-px-ish lines.
 * Used for photos / shaded drawings where the "lines" are object contours.
 */
function detectEdges(gray, w, h) {
  const mag = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1];
      const t = gray[i - w];
      const tr = gray[i - w + 1];
      const l = gray[i - 1];
      const r = gray[i + 1];
      const bl = gray[i + w - 1];
      const b = gray[i + w];
      const br = gray[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  if (max === 0) return new Uint8Array(w * h);

  // Threshold at the Otsu split of the (quantized) magnitude — adaptive per image.
  const q = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) q[i] = Math.round((mag[i] / max) * 255);
  const t = Math.max(otsuThreshold(q), 24); // floor avoids tracing flat noise
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < q.length; i++) bin[i] = q[i] >= t ? 1 : 0;
  return bin;
}

/** 3×3 dilation: a pixel is set if it or any 8-neighbor is set. */
function dilate(bin, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && bin[ny * w + nx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

/** 3×3 erosion: a pixel stays set only if it and all 8-neighbors are set. */
function erode(bin, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !bin[ny * w + nx]) {
            all = 0;
            break;
          }
        }
      }
      out[y * w + x] = all;
    }
  }
  return out;
}

/**
 * Morphological close (dilate → erode): bridges 1–2 px gaps so faint or
 * anti-aliased lines trace as continuous strokes instead of dashes.
 */
function close(bin, w, h) {
  return erode(dilate(bin, w, h), w, h);
}

/** In-place Zhang–Suen thinning. bin: Uint8Array of 0/1, foreground = 1. */
function thin(bin, w, h) {
  const idx = (x, y) => y * w + x;
  const toClear = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!bin[idx(x, y)]) continue;
          const p2 = bin[idx(x, y - 1)];
          const p3 = bin[idx(x + 1, y - 1)];
          const p4 = bin[idx(x + 1, y)];
          const p5 = bin[idx(x + 1, y + 1)];
          const p6 = bin[idx(x, y + 1)];
          const p7 = bin[idx(x - 1, y + 1)];
          const p8 = bin[idx(x - 1, y)];
          const p9 = bin[idx(x - 1, y - 1)];
          const bSum = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (bSum < 2 || bSum > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9];
          let a = 0;
          for (let i = 0; i < 8; i++) {
            if (seq[i] === 0 && seq[(i + 1) % 8] === 1) a++;
          }
          if (a !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toClear.push(idx(x, y));
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) bin[i] = 0;
      }
    }
  }
  return bin;
}

const NB = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Walk a 1-px skeleton into polylines, split at endpoints and junctions. */
function traceSkeleton(bin, w, h) {
  const idx = (x, y) => y * w + x;
  const fgNeighbors = (x, y) => {
    const out = [];
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && bin[idx(nx, ny)]) {
        out.push([nx, ny]);
      }
    }
    return out;
  };

  const usedEdge = new Set();
  const ekey = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  const paths = [];

  const walk = (sx, sy, nx, ny) => {
    const pts = [[sx, sy]];
    let px = sx;
    let py = sy;
    let cx = nx;
    let cy = ny;
    usedEdge.add(ekey(idx(px, py), idx(cx, cy)));
    for (;;) {
      pts.push([cx, cy]);
      const forward = fgNeighbors(cx, cy).filter(
        ([ax, ay]) => !(ax === px && ay === py),
      );
      if (fgNeighbors(cx, cy).length !== 2 || forward.length !== 1) break;
      const [fx, fy] = forward[0];
      const k = ekey(idx(cx, cy), idx(fx, fy));
      if (usedEdge.has(k)) break;
      usedEdge.add(k);
      px = cx;
      py = cy;
      cx = fx;
      cy = fy;
    }
    return pts;
  };

  // 1) Start from endpoints (degree 1) and junctions (degree ≥ 3).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[idx(x, y)]) continue;
      const deg = fgNeighbors(x, y).length;
      if (deg === 1 || deg >= 3) {
        for (const [nx, ny] of fgNeighbors(x, y)) {
          if (!usedEdge.has(ekey(idx(x, y), idx(nx, ny)))) {
            paths.push(walk(x, y, nx, ny));
          }
        }
      }
    }
  }
  // 2) Remaining pixels belong to closed loops (all degree 2).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[idx(x, y)]) continue;
      for (const [nx, ny] of fgNeighbors(x, y)) {
        if (!usedEdge.has(ekey(idx(x, y), idx(nx, ny)))) {
          paths.push(walk(x, y, nx, ny));
        }
      }
    }
  }
  return paths;
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

/** Ramer–Douglas–Peucker polyline simplification. */
function rdp(points, eps) {
  if (points.length < 3) return points;
  const stack = [[0, points.length - 1]];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0;
    let index = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const norm = Math.hypot(dx, dy) || 1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / norm;
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (maxD > eps && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function buildSvg(paths, w, h, strokeWidth) {
  const r = (n) => Math.round(n * 10) / 10;
  const d = paths
    .map((pl) =>
      pl.length === 1
        ? `M${r(pl[0][0])} ${r(pl[0][1])}h0`
        : `M${pl.map(([x, y], i) => `${i ? "L" : ""}${r(x)} ${r(y)}`).join(" ")}`,
    )
    .join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="#111111" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * Convert an image into a technical (centerline) line drawing SVG.
 * @param {string} imageBase64
 * @param {string} mimeType
 * @param {{ mode?: "auto" | "line" | "edge" }} [options]
 * @returns {Promise<{ svg: string, meta: object }>}
 */
async function imageToTechnicalSvg(imageBase64, mimeType, options = {}) {
  const started = Date.now();
  const { gray, width: w, height: h } = await toGray(imageBase64);

  const requested = options.mode || "auto";
  let mode = requested;
  let bin;
  if (requested === "line") {
    bin = binarizeInk(gray).bin;
  } else if (requested === "edge") {
    bin = detectEdges(gray, w, h);
  } else {
    // auto: treat it as a pen/pencil sketch only when the ink is genuinely dark
    // near-black strokes over mostly-white paper. Anything lighter or tonal
    // (photos, 3D renders, faint/colored line art) traces better from edges.
    const ink = binarizeInk(gray);
    const looksLikeInkSketch =
      ink.darkFraction >= 0.002 &&
      ink.darkFraction <= 0.2 &&
      ink.meanDark < 40;
    if (looksLikeInkSketch) {
      mode = "line";
      bin = ink.bin;
    } else {
      mode = "edge";
      bin = detectEdges(gray, w, h);
    }
  }

  bin = close(bin, w, h); // bridge small gaps → continuous strokes
  thin(bin, w, h);

  let paths = traceSkeleton(bin, w, h);
  paths = paths
    .filter((pl) => pl.length >= 2 && polylineLength(pl) >= MIN_LINE_LEN)
    .map((pl) => rdp(pl, SIMPLIFY_EPS));

  if (paths.length === 0) {
    throw new Error(
      "No lines detected in the image. Use a clearer image with visible outlines or strokes.",
    );
  }

  // Match the on-canvas stroke weight to how the drawing will be scaled to fit.
  const availW = TARGET.widthMm * (1 - 2 * TARGET.paddingRatio);
  const availH = TARGET.heightMm * (1 - 2 * TARGET.paddingRatio);
  const fitScale = Math.min(availW / w, availH / h);
  const strokeWidth = Math.max(0.8, Math.min(8, CANVAS_STROKE / fitScale));

  const rawSvg = buildSvg(paths, w, h, Math.round(strokeWidth * 100) / 100);
  const optimized = optimizeSvg(rawSvg);
  let canvased = applyTargetCanvas(optimized, { width: w, height: h });
  if (!isValidSvg(canvased)) {
    canvased = applyTargetCanvas(rawSvg, { width: w, height: h });
    if (!isValidSvg(canvased)) throw new Error("Technical SVG failed validation");
  }

  return {
    svg: canvased,
    meta: {
      elapsedMs: Date.now() - started,
      engine: "technical",
      mode,
      strokeCount: paths.length,
      sourceWidth: w,
      sourceHeight: h,
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

module.exports = { imageToTechnicalSvg };
