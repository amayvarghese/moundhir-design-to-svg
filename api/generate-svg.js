const { z } = require("zod");
const { traceImageToSvg } = require("./_tracer");
const { imageToTechnicalSvg } = require("./_technical");
const { generateSvgWithGroq } = require("./_groq");

const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z
    .string()
    .regex(/^image\//)
    .optional()
    .default("image/jpeg"),
  // "ai" (default)  → Groq vision model redraws it as clean, professional shapes.
  // "technical"     → deterministic centerline geometry (line/edge auto).
  // "line" / "edge" → technical, forcing the extraction method.
  // "silhouette"    → filled potrace trace.
  mode: z
    .enum(["ai", "technical", "line", "edge", "silhouette"])
    .optional()
    .default("ai"),
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

    const runTechnical = (m) =>
      imageToTechnicalSvg(imageBase64, mimeType, {
        mode: m === "technical" ? "auto" : m,
      });

    let result;
    if (mode === "ai") {
      // Groq redraws it as clean shapes; if the model/key is unavailable or the
      // response is unusable, fall back to the deterministic tracer.
      try {
        result = await generateSvgWithGroq(imageBase64, mimeType, {});
      } catch (aiError) {
        console.warn("[api/generate-svg] AI fallback:", aiError && aiError.message);
        result = await runTechnical("technical");
        result.meta = {
          ...result.meta,
          aiFallback: true,
          aiError: aiError instanceof Error ? aiError.message : String(aiError),
        };
      }
    } else if (mode === "silhouette") {
      result = await traceImageToSvg(imageBase64, mimeType);
    } else {
      result = await runTechnical(mode); // line | edge | auto
    }

    res.status(200).json({
      svg: result.svg,
      meta: { ...result.meta, retried: false, model: result.meta.model || result.meta.engine },
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
