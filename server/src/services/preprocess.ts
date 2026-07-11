import sharp from "sharp";

export interface PreparedImage {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}

/**
 * Prepare sketch photos for high-fidelity vision tracing:
 * resize ≤1536px, grayscale, contrast, denoise, sharpen → PNG.
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
    const maxDim = 1536;
    const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
    const width = meta.width ?? maxDim;
    const height = meta.height ?? maxDim;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(targetWidth, targetHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .grayscale()
      .normalize()
      .linear(1.45, -(128 * 0.45))
      .median(2)
      .sharpen({ sigma: 1.0, m1: 0.6, m2: 0.4 })
      .png({ compressionLevel: 9 })
      .toBuffer();

    if (buffer.length > 3_500_000) {
      const smaller = await sharp(buffer)
        .resize(Math.round(targetWidth * 0.75), Math.round(targetHeight * 0.75), {
          fit: "inside",
        })
        .jpeg({ quality: 92 })
        .toBuffer();
      const outMeta = await sharp(smaller).metadata();
      return {
        imageBase64: smaller.toString("base64"),
        mimeType: "image/jpeg",
        width: outMeta.width ?? targetWidth,
        height: outMeta.height ?? targetHeight,
      };
    }

    const outMeta = await sharp(buffer).metadata();
    return {
      imageBase64: buffer.toString("base64"),
      mimeType: "image/png",
      width: outMeta.width ?? targetWidth,
      height: outMeta.height ?? targetHeight,
    };
  } catch (err) {
    console.warn(
      "[preprocess] sharp unavailable:",
      err instanceof Error ? err.message : err,
    );
    if (input.length > 3_500_000) {
      throw new Error(
        "Image is too large and sharp is unavailable to resize it.",
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
