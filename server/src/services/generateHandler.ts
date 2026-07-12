import { z } from "zod";
import { generateSvgFromImage } from "./tracer.js";
import { getSvgDimensions } from "./svg.js";

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z
    .string()
    .regex(/^image\//, "mimeType must be an image/* type")
    .optional()
    .default("image/jpeg"),
  mode: z
    .enum(["ai", "technical", "line", "edge", "silhouette"])
    .optional()
    .default("ai"),
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

    const result = await generateSvgFromImage({
      imageBase64,
      mimeType,
      mode: parsed.data.mode,
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
    const status = /no shapes detected|failed validation|invalid SVG/i.test(
      message,
    )
      ? 422
      : 500;

    console.error("[generate-svg]", error);
    return { ok: false, error: { status, error: message } };
  }
}
