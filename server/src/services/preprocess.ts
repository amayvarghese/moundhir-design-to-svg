import sharp from "sharp";

export interface PreparedImage {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}

/**
 * Ensure the image is within Groq's base64 request limits (~4MB).
 * Resizes max dimension to 1024 when needed; otherwise passes through.
 */
export async function ensureImageUnderLimit(
  imageBase64: string,
  mimeType: string,
): Promise<PreparedImage> {
  const input = Buffer.from(imageBase64, "base64");
  const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;
  const maxDim = 1024;
  const needsResize = Math.max(width, height) > maxDim || input.length > 3_000_000;

  if (!needsResize) {
    const safeMime =
      mimeType === "image/png" || mimeType === "image/webp"
        ? mimeType
        : "image/jpeg";
    return {
      imageBase64,
      mimeType: safeMime,
      width,
      height,
    };
  }

  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const buffer = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(targetWidth, targetHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  const outMeta = await sharp(buffer).metadata();

  return {
    imageBase64: buffer.toString("base64"),
    mimeType: "image/jpeg",
    width: outMeta.width ?? targetWidth,
    height: outMeta.height ?? targetHeight,
  };
}

/** @deprecated Prefer ensureImageUnderLimit — kept for any legacy callers */
export async function preprocessImage(input: Buffer) {
  const prepared = await ensureImageUnderLimit(
    input.toString("base64"),
    "image/jpeg",
  );
  return {
    buffer: Buffer.from(prepared.imageBase64, "base64"),
    width: prepared.width,
    height: prepared.height,
    mimeType: prepared.mimeType,
  };
}
