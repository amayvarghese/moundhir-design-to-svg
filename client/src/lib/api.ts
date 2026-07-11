import type { GenerateSvgResponse, StoredSvg } from "../types";

const STORAGE_KEY = "sketch2svg:last-svg";

/** Parse a data URL into raw base64 + mime type. */
export function dataUrlToBase64(dataUrl: string): {
  imageBase64: string;
  mimeType: string;
} {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Expected a base64 data URL from the camera or upload");
  }
  return {
    mimeType: match[1],
    imageBase64: match[2],
  };
}

/**
 * Convert captured/uploaded image (data URL) → base64 JSON → Groq via backend.
 * Flow: base64 image → chat completions → extract SVG → return for browser render.
 */
export async function generateSvg(
  imageDataUrl: string,
): Promise<GenerateSvgResponse> {
  const { imageBase64, mimeType } = dataUrlToBase64(imageDataUrl);

  const response = await fetch("/generate-svg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mimeType }),
  });

  const data = (await response.json()) as
    | GenerateSvgResponse
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      "error" in data && data.error
        ? data.error
        : `Generation failed (${response.status})`,
    );
  }

  return data as GenerateSvgResponse;
}

export function persistSvg(payload: StoredSvg): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode — ignore
  }
}

export function loadPersistedSvg(): StoredSvg | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSvg;
  } catch {
    return null;
  }
}

export function downloadTextFile(
  content: string,
  filename: string,
  mime = "image/svg+xml",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadSvgAsPng(
  svg: string,
  filename: string,
): Promise<void> {
  const viewBoxMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  // Prefer viewBox user units (mm canvas) so 1.5m×3m exports at a sensible pixel size
  let width = 1500;
  let height = 3000;

  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/);
    if (parts.length === 4) {
      width = parseFloat(parts[2]) || width;
      height = parseFloat(parts[3]) || height;
    }
  } else {
    const widthMatch = svg.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
    const heightMatch = svg.match(/\bheight\s*=\s*["']([^"']+)["']/i);
    if (widthMatch) {
      const w = parseFloat(widthMatch[1]);
      // meters → treat as mm-scale preview if small number
      width = w <= 10 ? w * 1000 : w;
    }
    if (heightMatch) {
      const h = parseFloat(heightMatch[1]);
      height = h <= 10 ? h * 1000 : h;
    }
  }

  const scale = Math.min(1, 2048 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to rasterize SVG"));
    img.src = src;
  });
}

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

/** Auto-crop and center the drawing region by trimming near-white borders. */
export async function cropAndCenterDrawing(
  dataUrl: string,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const threshold = 235;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const luminance =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luminance < threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // If no dark content found, return original
  if (minX >= maxX || minY >= maxY) {
    return dataUrl;
  }

  const pad = Math.round(Math.max(width, height) * 0.04);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const side = Math.max(cropW, cropH);
  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const outCtx = out.getContext("2d");
  if (!outCtx) return dataUrl;

  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, side, side);
  const offsetX = Math.floor((side - cropW) / 2);
  const offsetY = Math.floor((side - cropH) / 2);
  outCtx.drawImage(
    canvas,
    minX,
    minY,
    cropW,
    cropH,
    offsetX,
    offsetY,
    cropW,
    cropH,
  );

  return out.toDataURL("image/jpeg", 0.92);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
