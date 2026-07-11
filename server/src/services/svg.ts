import { XMLParser, XMLValidator } from "fast-xml-parser";
import { optimize } from "svgo";
import { TARGET_CANVAS, formatPhysicalSize } from "../constants/canvas.js";

const FORBIDDEN_PATTERNS = [
  /<script[\s>]/i,
  /\bon\w+\s*=/i,
  /javascript\s*:/i,
  /<foreignObject[\s>]/i,
  /xlink:href\s*=\s*["'](?!#)/i,
  /href\s*=\s*["']https?:/i,
  /<image[\s>]/i,
];

export function extractSvg(raw: string): string {
  let text = raw.trim();

  // Strip Qwen / model thinking blocks if reasoning slipped into content
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?redacted_reasoning>/gi, "")
    .trim();

  // Strip markdown fences if the model ignores instructions
  const fenceMatch = text.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Some models HTML-escape the SVG
  if (!/<svg[\s>]/i.test(text) && /&lt;svg[\s>]/i.test(text)) {
    text = text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  }

  const start = text.search(/<svg\b/i);
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No SVG root element found in model response");
  }

  return text.slice(start, end + "</svg>".length).trim();
}

export function isValidSvg(svg: string): boolean {
  try {
    const validation = XMLValidator.validate(svg, {
      allowBooleanAttributes: true,
    });
    if (validation !== true) return false;

    const parser = new XMLParser({
      ignoreAttributes: false,
      preserveOrder: true,
    });
    const parsed = parser.parse(svg);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;

    const hasSvgRoot = parsed.some(
      (node: Record<string, unknown>) =>
        typeof node === "object" && node !== null && "svg" in node,
    );
    if (!hasSvgRoot) return false;

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(svg)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function parseViewBox(
  svg: string,
): { minX: number; minY: number; width: number; height: number } | null {
  const viewBoxMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (
      parts.length === 4 &&
      parts.every((n) => !Number.isNaN(n)) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      const [minX, minY, width, height] = parts;
      return { minX, minY, width, height };
    }
  }

  const widthMatch = svg.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
  const heightMatch = svg.match(/\bheight\s*=\s*["']([^"']+)["']/i);
  if (widthMatch && heightMatch) {
    const width = parseFloat(widthMatch[1]);
    const height = parseFloat(heightMatch[1]);
    if (width > 0 && height > 0) {
      return { minX: 0, minY: 0, width, height };
    }
  }

  return null;
}

export function ensureSvgAttributes(svg: string): string {
  let result = svg;

  if (!/xmlns\s*=/.test(result)) {
    result = result.replace(
      /<svg\b/,
      '<svg xmlns="http://www.w3.org/2000/svg"',
    );
  }

  const vb = parseViewBox(result);
  if (!vb) {
    result = result.replace(
      /<svg\b/,
      `<svg width="${TARGET_CANVAS.widthAttr}" height="${TARGET_CANVAS.heightAttr}" viewBox="${TARGET_CANVAS.viewBox}"`,
    );
  }

  return result;
}

/**
 * Fit artwork into a fixed 1.5 m × 3 m canvas (viewBox in mm: 1500 × 3000).
 * Preserves aspect ratio and centers the drawing with padding.
 */
export function applyTargetCanvas(svg: string): string {
  if (/data-sketch2svg-canvas\s*=\s*["']1\.5x3["']/i.test(svg)) {
    // Still normalize root attrs in case SVGO touched them
    return svg
      .replace(/\bwidth\s*=\s*["'][^"']*["']/i, `width="${TARGET_CANVAS.widthAttr}"`)
      .replace(/\bheight\s*=\s*["'][^"']*["']/i, `height="${TARGET_CANVAS.heightAttr}"`)
      .replace(
        /\bviewBox\s*=\s*["'][^"']*["']/i,
        `viewBox="${TARGET_CANVAS.viewBox}"`,
      );
  }

  const openMatch = svg.match(/<svg\b[^>]*>/i);
  if (!openMatch || openMatch.index === undefined) {
    return svg;
  }

  const openEnd = openMatch.index + openMatch[0].length;
  const closeIdx = svg.toLowerCase().lastIndexOf("</svg>");
  if (closeIdx === -1) return svg;

  const inner = svg.slice(openEnd, closeIdx).trim();
  const source = parseViewBox(svg) ?? {
    minX: 0,
    minY: 0,
    width: TARGET_CANVAS.widthMm,
    height: TARGET_CANVAS.heightMm,
  };

  const { widthMm: targetW, heightMm: targetH, paddingRatio } = TARGET_CANVAS;
  const sameCanvas =
    Math.abs(source.width - targetW) < 0.5 &&
    Math.abs(source.height - targetH) < 0.5 &&
    Math.abs(source.minX) < 0.5 &&
    Math.abs(source.minY) < 0.5;

  let body: string;
  if (sameCanvas) {
    body = inner;
  } else {
    const availW = targetW * (1 - 2 * paddingRatio);
    const availH = targetH * (1 - 2 * paddingRatio);
    const scale = Math.min(availW / source.width, availH / source.height);
    const scaledW = source.width * scale;
    const scaledH = source.height * scale;
    const tx = (targetW - scaledW) / 2 - source.minX * scale;
    const ty = (targetH - scaledH) / 2 - source.minY * scale;
    body = `<g data-sketch2svg-fit="1" transform="translate(${round(tx)} ${round(ty)}) scale(${round(scale)})">${inner}</g>`;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${TARGET_CANVAS.widthAttr}"`,
    ` height="${TARGET_CANVAS.heightAttr}"`,
    ` viewBox="${TARGET_CANVAS.viewBox}"`,
    ` data-sketch2svg-canvas="1.5x3"`,
    ` data-physical-size="${formatPhysicalSize()}">`,
    body,
    `</svg>`,
  ].join("");
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function optimizeSvg(svg: string): string {
  const result = optimize(svg, {
    multipass: true,
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            removeUnknownsAndDefaults: false,
            convertPathData: false,
            mergePaths: false,
            convertShapeToPath: false,
          },
        },
      },
    ],
  });

  return applyTargetCanvas(result.data);
}

export function getSvgDimensions(svg: string): {
  width: number | null;
  height: number | null;
  widthMeters: number;
  heightMeters: number;
  physicalSize: string;
  viewBox: string | null;
  unit: "m";
} {
  const viewBox =
    svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? TARGET_CANVAS.viewBox;

  return {
    width: TARGET_CANVAS.widthMm,
    height: TARGET_CANVAS.heightMm,
    widthMeters: TARGET_CANVAS.widthMeters,
    heightMeters: TARGET_CANVAS.heightMeters,
    physicalSize: formatPhysicalSize(),
    viewBox,
    unit: "m",
  };
}

export function sanitizeAndOptimize(raw: string): string {
  const extracted = extractSvg(raw);
  const withAttrs = ensureSvgAttributes(extracted);
  if (!isValidSvg(withAttrs)) {
    throw new Error("SVG failed validation");
  }
  const optimized = optimizeSvg(withAttrs);
  const canvased = applyTargetCanvas(optimized);
  if (!isValidSvg(canvased)) {
    const fallback = applyTargetCanvas(withAttrs);
    if (!isValidSvg(fallback)) {
      throw new Error("SVG failed validation after canvas fit");
    }
    return fallback;
  }
  return canvased;
}
