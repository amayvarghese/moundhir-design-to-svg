import { z } from "zod";
import { generateSvgFromImage } from "./groq.js";
import { getSvgDimensions } from "./svg.js";
import { ensureImageUnderLimit } from "./preprocess.js";

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z
    .string()
    .regex(/^image\//, "mimeType must be an image/* type")
    .optional()
    .default("image/jpeg"),
});

export type GenerateSvgBody = z.infer<typeof bodySchema>;

export type GenerateSvgSuccess = {
  svg: string;
  meta: {
    elapsedMs: number;
    retried: boolean;
    model: string;
    width: number | null;
    height: number | null;
    widthMeters: number;
    heightMeters: number;
    physicalSize: string;
    unit: "m";
    viewBox: string | null;
  };
};

export type GenerateSvgFailure = {
  status: number;
  error: string;
  details?: unknown;
};

export async function handleGenerateSvgRequest(
  body: unknown,
): Promise<{ ok: true; data: GenerateSvgSuccess } | { ok: false; error: GenerateSvgFailure }> {
  const started = Date.now();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: 400,
        error:
          "Send JSON { imageBase64: string, mimeType?: string }. Convert the captured/uploaded image to base64 first.",
        details: parsed.error.flatten(),
      },
    };
  }

  try {
    let { imageBase64, mimeType } = parsed.data;
    const dataUrlMatch = imageBase64.match(
      /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i,
    );
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      imageBase64 = dataUrlMatch[2];
    } else {
      imageBase64 = imageBase64.replace(/^data:[^;]+;base64,/i, "");
    }

    const prepared = await ensureImageUnderLimit(imageBase64, mimeType);
    const result = await generateSvgFromImage({
      imageBase64: prepared.imageBase64,
      mimeType: prepared.mimeType,
    });
    const dimensions = getSvgDimensions(result.svg);

    return {
      ok: true,
      data: {
        svg: result.svg,
        meta: {
          elapsedMs: Date.now() - started,
          retried: result.retried,
          model: result.model,
          width: dimensions.width,
          height: dimensions.height,
          widthMeters: dimensions.widthMeters,
          heightMeters: dimensions.heightMeters,
          physicalSize: dimensions.physicalSize,
          unit: dimensions.unit,
          viewBox: dimensions.viewBox,
        },
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error";
    const status =
      message.includes("GROQ_API_KEY") || message.includes("configured")
        ? 503
        : message.includes("invalid SVG")
          ? 422
          : 500;

    console.error("[generate-svg]", error);
    return { ok: false, error: { status, error: message } };
  }
}
