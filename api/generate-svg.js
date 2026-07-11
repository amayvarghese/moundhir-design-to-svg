const { z } = require("zod");
const { traceImageToSvg } = require("./_tracer");
const { imageToTechnicalSvg } = require("./_technical");

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z
    .string()
    .regex(/^image\//)
    .optional()
    .default("image/jpeg"),
  // "technical" (default) → clean centerline line drawing.
  // "line" / "edge"        → technical drawing, forcing the extraction method.
  // "silhouette"           → filled potrace trace (legacy behavior).
  mode: z
    .enum(["technical", "line", "edge", "silhouette"])
    .optional()
    .default("technical"),
});

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Send JSON { imageBase64: string, mimeType?: string }. Convert the captured/uploaded image to base64 first.",
        details: parsed.error.flatten(),
      });
      return;
    }

    let { imageBase64, mimeType, mode } = parsed.data;
    const dataUrlMatch = imageBase64.match(
      /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i,
    );
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      imageBase64 = dataUrlMatch[2];
    } else {
      imageBase64 = imageBase64.replace(/^data:[^;]+;base64,/i, "");
    }

    let result;
    if (mode === "silhouette") {
      result = await traceImageToSvg(imageBase64, mimeType);
    } else {
      const traceMode = mode === "technical" ? "auto" : mode; // line | edge | auto
      result = await imageToTechnicalSvg(imageBase64, mimeType, {
        mode: traceMode,
      });
    }

    res.status(200).json({
      svg: result.svg,
      meta: { ...result.meta, retried: false, model: result.meta.engine },
    });
  } catch (error) {
    console.error("[api/generate-svg]", error);
    const message =
      error instanceof Error ? error.message : "Unexpected serverless error";
    const status = /no (shapes|lines) detected|failed validation/i.test(message)
      ? 422
      : 500;
    res.status(status).json({ error: message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
  maxDuration: 60,
};
