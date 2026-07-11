export interface PreparedImage {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}

/**
 * Ensure the image is within Groq's base64 request limits (~4MB).
 * Uses sharp when available; otherwise passes the original through if small enough.
 */
export async function ensureImageUnderLimit(
  imageBase64: string,
  mimeType: string,
): Promise<PreparedImage> {
  const input = Buffer.from(imageBase64, "base64");
  const safeMime =
    mimeType === "image/png" || mimeType === "image/webp"
      ? mimeType
      : "image/jpeg";

  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
    const width = meta.width ?? 1024;
    const height = meta.height ?? 1024;
    const maxDim = 1024;
    const needsResize =
      Math.max(width, height) > maxDim || input.length > 3_000_000;

    if (!needsResize) {
      return { imageBase64, mimeType: safeMime, width, height };
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
  } catch (err) {
    console.warn(
      "[preprocess] sharp unavailable, using original image:",
      err instanceof Error ? err.message : err,
    );

    if (input.length > 3_500_000) {
      throw new Error(
        "Image is too large for Groq and sharp is unavailable to resize it.",
      );
    }

    return {
      imageBase64,
      mimeType: safeMime,
      width: 1024,
      height: 1024,
    };
  }
}
