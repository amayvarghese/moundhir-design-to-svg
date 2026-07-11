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
/** Drop traced polylines shorter than this many pixels (speckle removal). */
const MIN_LINE_LEN = 7;
/** Max perpendicular wander (px) for a stroke to count as a perfectly straight line. */
const LINE_TOL = 2.8;
/** Max RMS radial error (px) for a stroke to count as a circle/arc. */
const CIRCLE_TOL = 2.2;
/** Turn angle (deg) between local tangents that marks a hard corner to split at. */
const CORNER_ANGLE = 32;
/** Neighbour offset (px) for the turn-angle baseline — large enough to ignore 1px jitter. */
const CORNER_K = 6;
/** Snap near-horizontal / near-vertical lines within this many degrees. */
const AXIS_SNAP_DEG = 3;

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
 * Morphological close (dilate ×n → erode ×n): bridges gaps up to ~2·n px so
 * faint, dashed or anti-aliased lines trace as continuous strokes — which lets
 * a broken circle re-form into one loop that fits cleanly as a single circle.
 */
function close(bin, w, h, amount = 1) {
  let b = bin;
  for (let i = 0; i < amount; i++) b = dilate(b, w, h);
  for (let i = 0; i < amount; i++) b = erode(b, w, h);
  return b;
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

// Ordered 8-neighbourhood (p2..p9, clockwise from north) for transition counting.
const RING = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/**
 * Walk a 1-px skeleton into polylines, split at genuine endpoints and junctions.
 *
 * Junctions are classified by the neighbourhood transition count (number of
 * distinct branches), not the raw neighbour count — so diagonal "staircase"
 * pixels, which have 3 neighbours but only 2 branches, are correctly treated as
 * pass-throughs instead of shattering every diagonal line and circle into bits.
 * While walking, neighbours 8-adjacent to where we came from are skipped, which
 * follows staircases cleanly.
 */
function traceSkeleton(bin, w, h) {
  const idx = (x, y) => y * w + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const fgNeighbors = (x, y) => {
    const out = [];
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (inb(nx, ny) && bin[idx(nx, ny)]) out.push([nx, ny]);
    }
    return out;
  };
  const branches = (x, y) => {
    let a = 0;
    for (let i = 0; i < 8; i++) {
      const [dx0, dy0] = RING[i];
      const [dx1, dy1] = RING[(i + 1) % 8];
      const c = inb(x + dx0, y + dy0) && bin[idx(x + dx0, y + dy0)] ? 1 : 0;
      const n = inb(x + dx1, y + dy1) && bin[idx(x + dx1, y + dy1)] ? 1 : 0;
      if (c === 0 && n === 1) a++;
    }
    return a;
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
      if (branches(cx, cy) >= 3) break; // real junction — stop, others start here
      const forward = fgNeighbors(cx, cy).filter(
        ([ax, ay]) => !(ax === px && ay === py),
      );
      if (forward.length === 0) break; // endpoint
      // Pass-through: pick the straightest continuation (handles staircases).
      const dirx = cx - px;
      const diry = cy - py;
      let best = forward[0];
      let bestDot = -Infinity;
      for (const [fx, fy] of forward) {
        const dot = (fx - cx) * dirx + (fy - cy) * diry;
        if (dot > bestDot) {
          bestDot = dot;
          best = [fx, fy];
        }
      }
      const [fx, fy] = best;
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

  // 1) Start from endpoints (1 branch) and junctions (≥ 3 branches).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[idx(x, y)]) continue;
      const a = branches(x, y);
      if (a === 1 || a >= 3) {
        for (const [nx, ny] of fgNeighbors(x, y)) {
          if (!usedEdge.has(ekey(idx(x, y), idx(nx, ny)))) {
            paths.push(walk(x, y, nx, ny));
          }
        }
      }
    }
  }
  // 2) Remaining pixels belong to closed loops (every pixel a pass-through).
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

// ── Geometric primitive fitting ────────────────────────────────────────────
// Each traced stroke is fitted to the simplest exact primitive it supports —
// a perfectly straight line, a true circle, or a circular arc — so the output
// reads as a clean geometric technical drawing instead of a wobbly polyline.

/** Turn angle in degrees (0–180) between segments a→b and b→c. */
function turnAngle(a, b, c) {
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = c[0] - b[0];
  const v2y = c[1] - b[1];
  const n1 = Math.hypot(v1x, v1y) || 1;
  const n2 = Math.hypot(v2x, v2y) || 1;
  let cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Split a polyline at hard corners (local turn angle > CORNER_ANGLE), with NMS. */
function splitAtCorners(pts) {
  const n = pts.length;
  const k = CORNER_K;
  if (n < 2 * k + 2) return [pts];
  const ang = new Array(n).fill(0);
  for (let i = k; i < n - k; i++) ang[i] = turnAngle(pts[i - k], pts[i], pts[i + k]);

  const corners = [];
  for (let i = k; i < n - k; i++) {
    if (ang[i] <= CORNER_ANGLE) continue;
    let isMax = true;
    for (let j = Math.max(k, i - k); j <= Math.min(n - k - 1, i + k); j++) {
      if (ang[j] > ang[i]) {
        isMax = false;
        break;
      }
    }
    if (isMax) corners.push(i);
  }

  const cut = [0, ...corners, n - 1];
  const segs = [];
  for (let s = 0; s < cut.length - 1; s++) {
    const seg = pts.slice(cut[s], cut[s + 1] + 1);
    if (seg.length >= 2) segs.push(seg);
  }
  return segs;
}

/** Total-least-squares (PCA) line fit. Returns endpoints projected onto the line. */
function fitLine(pts) {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  let maxDev = 0;
  for (const [x, y] of pts) {
    const perp = Math.abs((x - mx) * -dy + (y - my) * dx);
    if (perp > maxDev) maxDev = perp;
  }
  const project = (p) => {
    const t = (p[0] - mx) * dx + (p[1] - my) * dy;
    return [mx + dx * t, my + dy * t];
  };
  return { maxDev, a: project(pts[0]), b: project(pts[pts.length - 1]) };
}

/** Solve a 3×3 linear system by Cramer's rule; null if near-singular. */
function solve3(m, v) {
  const det = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const col = (a, i, r) => a.map((row, k) => row.map((x, j) => (j === i ? r[k] : x)));
  return [det(col(m, 0, v)) / d, det(col(m, 1, v)) / d, det(col(m, 2, v)) / d];
}

/** Kasa algebraic circle fit. Returns { cx, cy, R, rms } or null. */
function fitCircle(pts) {
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const sol = solve3(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (r2 <= 0) return null;
  const R = Math.sqrt(r2);
  let rms = 0;
  for (const [x, y] of pts) {
    const d = Math.hypot(x - cx, y - cy) - R;
    rms += d * d;
  }
  return { cx, cy, R, rms: Math.sqrt(rms / n) };
}

/** Decide a good circle fit is a full circle or an arc; build that primitive. */
function circleOrArc(seg, circle) {
  const { cx, cy, R } = circle;
  let total = 0;
  for (let i = 1; i < seg.length; i++) {
    const a0 = Math.atan2(seg[i - 1][1] - cy, seg[i - 1][0] - cx);
    const a1 = Math.atan2(seg[i][1] - cy, seg[i][0] - cx);
    let dd = a1 - a0;
    while (dd > Math.PI) dd -= 2 * Math.PI;
    while (dd < -Math.PI) dd += 2 * Math.PI;
    total += dd;
  }
  const coverage = (Math.abs(total) * 180) / Math.PI;
  if (coverage >= 300) return { t: "C", cx, cy, r: R };
  if (coverage < 18) return null;
  const onCircle = (p) => {
    const ang = Math.atan2(p[1] - cy, p[0] - cx);
    return [cx + R * Math.cos(ang), cy + R * Math.sin(ang)];
  };
  return {
    t: "A",
    a: onCircle(seg[0]),
    b: onCircle(seg[seg.length - 1]),
    r: R,
    cx,
    cy,
    coverage,
    large: coverage > 180 ? 1 : 0,
    sweep: total > 0 ? 1 : 0,
  };
}

/** Index of the point furthest from the chord through the segment's endpoints. */
function maxDevIndex(seg) {
  const [ax, ay] = seg[0];
  const [bx, by] = seg[seg.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const norm = Math.hypot(dx, dy) || 1;
  let maxD = -1;
  let idx = -1;
  for (let i = 1; i < seg.length - 1; i++) {
    const d = Math.abs((seg[i][0] - ax) * dy - (seg[i][1] - ay) * dx) / norm;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  return idx;
}

/** Snap a line's endpoints to horizontal / vertical when it is nearly axis-aligned. */
function snapAxis(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const near = (deg) => Math.abs(((angle - deg + 540) % 360) - 180) > 180 - AXIS_SNAP_DEG;
  if (near(0) || near(180)) {
    const y = (a[1] + b[1]) / 2;
    return [[a[0], y], [b[0], y]];
  }
  if (near(90) || near(-90)) {
    const x = (a[0] + b[0]) / 2;
    return [[x, a[1]], [x, b[1]]];
  }
  return [a, b];
}

/** Fit one corner-free segment into line / arc / circle primitives (recursive). */
function fitSegment(seg, depth = 0) {
  if (seg.length < 2) return [];
  if (seg.length === 2) {
    const [a, b] = snapAxis(seg[0], seg[1]);
    return [{ t: "L", a, b }];
  }
  const line = fitLine(seg);
  if (line.maxDev <= LINE_TOL) {
    const [a, b] = snapAxis(line.a, line.b);
    return [{ t: "L", a, b }];
  }
  if (seg.length >= 10) {
    const circle = fitCircle(seg);
    // Allow a little more wander on bigger circles, but cap it: a genuinely round
    // stroke fits tightly, so a loose fit (e.g. a straight edge) is rejected → line.
    const tol = circle
      ? Math.min(6, Math.max(CIRCLE_TOL, circle.R * 0.04))
      : 0;
    if (circle && circle.rms <= tol && circle.R >= 6 && circle.R <= 5000) {
      const prim = circleOrArc(seg, circle);
      if (prim && prim.t === "C") return [prim];
      if (prim && prim.t === "A") {
        // Reject near-flat arcs (radius ≫ chord): they read as straight lines.
        const chord = Math.hypot(
          seg[0][0] - seg[seg.length - 1][0],
          seg[0][1] - seg[seg.length - 1][1],
        );
        if (circle.R <= chord * 3) return [prim];
      }
    }
  }
  if (depth < 8) {
    const idx = maxDevIndex(seg);
    if (idx > 0 && idx < seg.length - 1) {
      return [
        ...fitSegment(seg.slice(0, idx + 1), depth + 1),
        ...fitSegment(seg.slice(idx), depth + 1),
      ];
    }
  }
  const [a, b] = snapAxis(line.a, line.b);
  return [{ t: "L", a, b }];
}

/** 3-tap moving average to damp 1-px skeleton jitter before fitting. */
function smoothPolyline(pts) {
  if (pts.length < 5) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push([
      (pts[i - 1][0] + pts[i][0] + pts[i + 1][0]) / 3,
      (pts[i - 1][1] + pts[i][1] + pts[i + 1][1]) / 3,
    ]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Fit a whole traced polyline into geometric primitives. */
function fitPolyline(pts) {
  const smooth = smoothPolyline(pts);
  const prims = [];
  for (const seg of splitAtCorners(smooth)) {
    for (const prim of fitSegment(seg)) prims.push(prim);
  }
  return prims;
}

// ── Consolidate fragments ───────────────────────────────────────────────────
// Faint or dashed source lines get traced as many disconnected pieces. Merge
// collinear segments into single straight lines, and co-circular arcs into whole
// circles, so a broken circle reads as one circle and a dashed edge as one line.

/** Merge near-collinear, near-touching line segments into single lines. */
function mergeLines(lines, diag) {
  const ANGLE_TOL = 5; // degrees
  const OFFSET_TOL = Math.max(4, diag * 0.006); // perpendicular separation (px)
  const GAP_TOL = diag * 0.04; // end-to-end gap that may be bridged (px)

  const items = lines.map((l) => {
    let dx = l.b[0] - l.a[0];
    let dy = l.b[1] - l.a[1];
    if (dx < 0 || (dx === 0 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    const offset = -uy * l.a[0] + ux * l.a[1]; // signed perpendicular offset
    return { l, ux, uy, angle, offset, used: false };
  });

  const angleClose = (x, y) => {
    const d = Math.abs(x - y) % 180;
    return Math.min(d, 180 - d) <= ANGLE_TOL;
  };

  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].used) continue;
    const group = [items[i]];
    items[i].used = true;
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].used) continue;
      if (
        angleClose(items[i].angle, items[j].angle) &&
        Math.abs(items[i].offset - items[j].offset) <= OFFSET_TOL
      ) {
        group.push(items[j]);
        items[j].used = true;
      }
    }
    // Project all endpoints onto the reference direction; merge overlapping runs.
    const { ux, uy } = items[i];
    const refx = items[i].l.a[0];
    const refy = items[i].l.a[1];
    const proj = (p) => (p[0] - refx) * ux + (p[1] - refy) * uy;
    const spans = [];
    for (const g of group) {
      const t0 = proj(g.l.a);
      const t1 = proj(g.l.b);
      spans.push([Math.min(t0, t1), Math.max(t0, t1)]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let [lo, hi] = spans[0];
    const flush = () => {
      const meanOff = group.reduce((s, g) => s + g.offset, 0) / group.length;
      // Shift the reference point along the normal onto the averaged-offset line.
      const refOff = -uy * refx + ux * refy;
      const shift = meanOff - refOff;
      const bx = refx + -uy * shift;
      const by = refy + ux * shift;
      out.push({
        t: "L",
        a: [bx + ux * lo, by + uy * lo],
        b: [bx + ux * hi, by + uy * hi],
      });
    };
    for (let k = 1; k < spans.length; k++) {
      const [s, e] = spans[k];
      if (s <= hi + GAP_TOL) {
        hi = Math.max(hi, e);
      } else {
        flush();
        lo = s;
        hi = e;
      }
    }
    flush();
  }
  return out;
}

/** Merge arcs/circles that lie on the same circle; complete near-full ones. */
function mergeCircular(items, diag) {
  const CENTER_TOL = Math.max(5, diag * 0.012);
  const R_TOL = Math.max(5, diag * 0.012);
  const groups = [];
  for (const it of items) {
    const { cx, cy, r } = it; // both arcs and circles carry cx, cy, r
    let g = groups.find(
      (gr) =>
        Math.hypot(gr.cx - cx, gr.cy - cy) <= CENTER_TOL &&
        Math.abs(gr.r - r) <= R_TOL,
    );
    if (!g) {
      g = { cx, cy, r, n: 0, coverage: 0, members: [] };
      groups.push(g);
    }
    // Running average of center/radius, weighted by count.
    g.cx = (g.cx * g.n + cx) / (g.n + 1);
    g.cy = (g.cy * g.n + cy) / (g.n + 1);
    g.r = (g.r * g.n + r) / (g.n + 1);
    g.n += 1;
    g.coverage += it.t === "C" ? 360 : it.coverage || 0;
    g.members.push(it);
  }

  const out = [];
  for (const g of groups) {
    if (g.members.some((m) => m.t === "C") || g.coverage >= 300) {
      out.push({ t: "C", cx: g.cx, cy: g.cy, r: g.r });
    } else {
      out.push(...g.members); // keep partial arcs as-is
    }
  }
  return out;
}

/** Consolidate fitted primitives into whole lines and circles. */
function mergePrimitives(prims, w, h) {
  const diag = Math.hypot(w, h);
  const lines = prims.filter((p) => p.t === "L");
  const circular = prims.filter((p) => p.t === "A" || p.t === "C");
  return [...mergeCircular(circular, diag), ...mergeLines(lines, diag)];
}

function buildSvg(prims, w, h, strokeWidth) {
  const r = (n) => Math.round(n * 10) / 10;
  const circles = [];
  let d = "";
  for (const p of prims) {
    if (p.t === "C") {
      circles.push(`<circle cx="${r(p.cx)}" cy="${r(p.cy)}" r="${r(p.r)}"/>`);
    } else if (p.t === "L") {
      d += `M${r(p.a[0])} ${r(p.a[1])}L${r(p.b[0])} ${r(p.b[1])}`;
    } else if (p.t === "A") {
      d += `M${r(p.a[0])} ${r(p.a[1])}A${r(p.r)} ${r(p.r)} 0 ${p.large} ${p.sweep} ${r(p.b[0])} ${r(p.b[1])}`;
    }
  }
  const path = d ? `<path d="${d}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="none" stroke="#111111" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${circles.join("")}${path}</g></svg>`;
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

  // Bridge gaps so dashed/faint strokes reconnect. Edge maps are noisier and
  // more broken than solid ink, so close them a little more aggressively.
  bin = close(bin, w, h, mode === "edge" ? 2 : 1);
  thin(bin, w, h);

  const polylines = traceSkeleton(bin, w, h).filter(
    (pl) => pl.length >= 2 && polylineLength(pl) >= MIN_LINE_LEN,
  );

  // Fit each traced stroke to exact geometry: straight lines, circles, arcs.
  const fitted = [];
  for (const pl of polylines) {
    for (const prim of fitPolyline(pl)) fitted.push(prim);
  }
  // Consolidate fragments: whole circles from dashed arcs, whole lines from dashes.
  const prims = mergePrimitives(fitted, w, h);

  if (prims.length === 0) {
    throw new Error(
      "No lines detected in the image. Use a clearer image with visible outlines or strokes.",
    );
  }

  // Match the on-canvas stroke weight to how the drawing will be scaled to fit.
  const availW = TARGET.widthMm * (1 - 2 * TARGET.paddingRatio);
  const availH = TARGET.heightMm * (1 - 2 * TARGET.paddingRatio);
  const fitScale = Math.min(availW / w, availH / h);
  const strokeWidth = Math.max(0.8, Math.min(8, CANVAS_STROKE / fitScale));

  const rawSvg = buildSvg(prims, w, h, Math.round(strokeWidth * 100) / 100);
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
      strokeCount: prims.length,
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
