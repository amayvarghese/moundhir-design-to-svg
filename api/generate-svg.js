const Groq = require("groq-sdk");
const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { optimize } = require("svgo");
const { z } = require("zod");
const { CONVERT_PROMPT, FIX_PROMPT } = require("./_prompts");

const TARGET = {
  widthAttr: "1.5m",
  heightAttr: "3m",
  viewBox: "0 0 1500 3000",
  widthMm: 1500,
  heightMm: 3000,
  widthMeters: 1.5,
  heightMeters: 3,
  paddingRatio: 0.04,
};
const bodySchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z
    .string()
    .regex(/^image\//)
    .optional()
    .default("image/jpeg"),
});

function requireGroqApiKey() {
  const key = (process.env.GROQ_API_KEY || "").trim();
  if (!key || key === "your_groq_api_key_here") {
    throw new Error(
      "GROQ_API_KEY is not configured. Set it in Vercel Project Settings → Environment Variables.",
    );
  }
  return key;
}

function extractSvg(raw) {
  let text = String(raw || "").trim();
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();

  const fence = text.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

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

function isValidSvg(svg) {
  try {
    if (XMLValidator.validate(svg, { allowBooleanAttributes: true }) !== true) {
      return false;
    }
    const parsed = new XMLParser({
      ignoreAttributes: false,
      preserveOrder: true,
    }).parse(svg);
    return (
      Array.isArray(parsed) &&
      parsed.some((n) => n && typeof n === "object" && "svg" in n)
    );
  } catch {
    return false;
  }
}

function parseViewBox(svg) {
  const m = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (m) {
    const parts = m[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
    }
  }
  return null;
}

function applyTargetCanvas(svg) {
  if (/data-sketch2svg-canvas\s*=\s*["']1\.5x3["']/i.test(svg)) {
    return svg
      .replace(/\bwidth\s*=\s*["'][^"']*["']/i, `width="${TARGET.widthAttr}"`)
      .replace(/\bheight\s*=\s*["'][^"']*["']/i, `height="${TARGET.heightAttr}"`)
      .replace(/\bviewBox\s*=\s*["'][^"']*["']/i, `viewBox="${TARGET.viewBox}"`);
  }

  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open || open.index === undefined) return svg;
  const openEnd = open.index + open[0].length;
  const closeIdx = svg.toLowerCase().lastIndexOf("</svg>");
  if (closeIdx === -1) return svg;

  const inner = svg.slice(openEnd, closeIdx).trim();
  const source = parseViewBox(svg) || {
    minX: 0,
    minY: 0,
    width: TARGET.widthMm,
    height: TARGET.heightMm,
  };

  const same =
    Math.abs(source.width - TARGET.widthMm) < 0.5 &&
    Math.abs(source.height - TARGET.heightMm) < 0.5;

  let body = inner;
  if (!same) {
    const availW = TARGET.widthMm * (1 - 2 * TARGET.paddingRatio);
    const availH = TARGET.heightMm * (1 - 2 * TARGET.paddingRatio);
    const scale = Math.min(availW / source.width, availH / source.height);
    const scaledW = source.width * scale;
    const scaledH = source.height * scale;
    const tx = (TARGET.widthMm - scaledW) / 2 - source.minX * scale;
    const ty = (TARGET.heightMm - scaledH) / 2 - source.minY * scale;
    const r = (n) => Math.round(n * 10000) / 10000;
    body = `<g data-sketch2svg-fit="1" transform="translate(${r(tx)} ${r(ty)}) scale(${r(scale)})">${inner}</g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET.widthAttr}" height="${TARGET.heightAttr}" viewBox="${TARGET.viewBox}" data-sketch2svg-canvas="1.5x3" data-physical-size="1.5 m × 3 m">${body}</svg>`;
}

function sanitizeAndOptimize(raw) {
  const extracted = extractSvg(raw);
  if (!isValidSvg(extracted)) throw new Error("SVG failed validation");
  let optimized = extracted;
  try {
    optimized = optimize(extracted, {
      multipass: true,
      plugins: [
        {
          name: "preset-default",
          params: {
            overrides: {
              // Keep geometry faithful — avoid aggressive path rewriting
              convertPathData: false,
              mergePaths: false,
              convertShapeToPath: false,
              removeViewBox: false,
            },
          },
        },
      ],
    }).data;
  } catch {
    optimized = extracted;
  }
  const canvased = applyTargetCanvas(optimized);
  if (!isValidSvg(canvased)) {
    const fallback = applyTargetCanvas(extracted);
    if (!isValidSvg(fallback)) throw new Error("SVG failed validation after canvas fit");
    return fallback;
  }
  return canvased;
}

async function ensureImageUnderLimit(imageBase64, mimeType) {
  const input = Buffer.from(imageBase64, "base64");
  const safeMime =
    mimeType === "image/png" || mimeType === "image/webp" ? mimeType : "image/jpeg";

  try {
    const sharp = require("sharp");
    const maxDim = 1536;
    const pipeline = sharp(input, { failOn: "none" }).rotate();
    const meta = await pipeline.metadata();
    const width = meta.width || maxDim;
    const height = meta.height || maxDim;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));

    // Always enhance line art for the vision model (higher fidelity tracing)
    const buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(tw, th, { fit: "inside", withoutEnlargement: true })
      .grayscale()
      .normalize()
      .linear(1.45, -(128 * 0.45))
      .median(2)
      .sharpen({ sigma: 1.0, m1: 0.6, m2: 0.4 })
      .png({ compressionLevel: 9 })
      .toBuffer();

    if (buffer.length > 3_500_000) {
      const smaller = await sharp(buffer)
        .resize(Math.round(tw * 0.75), Math.round(th * 0.75), {
          fit: "inside",
        })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { imageBase64: smaller.toString("base64"), mimeType: "image/jpeg" };
    }

    return { imageBase64: buffer.toString("base64"), mimeType: "image/png" };
  } catch (err) {
    console.warn("[preprocess] sharp fallback:", err && err.message);
    if (input.length > 3_500_000) {
      throw new Error("Image too large and sharp is unavailable to resize it.");
    }
    return { imageBase64, mimeType: safeMime };
  }
}

function collectMessageText(message) {
  if (!message) return "";
  const parts = [];
  if (typeof message.content === "string" && message.content.trim()) {
    parts.push(message.content);
  }
  if (typeof message.reasoning === "string" && message.reasoning.trim()) {
    parts.push(message.reasoning);
  }
  return parts.join("\n").trim();
}

async function callGroq(messages) {
  const model = (process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b").trim();
  const client = new Groq({ apiKey: requireGroqApiKey() });
  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    max_completion_tokens: 16384,
    top_p: 0.85,
    reasoning_effort: "none",
    reasoning_format: "parsed",
  });
  const content = collectMessageText(completion.choices[0] && completion.choices[0].message);
  if (!content) throw new Error("Empty response from Groq");
  return { content, model };
}

async function generateSvgFromImage(imageBase64, mimeType) {
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const imagePart = { type: "image_url", image_url: { url: dataUrl } };
  const firstMessages = [
    {
      role: "user",
      content: [{ type: "text", text: CONVERT_PROMPT }, imagePart],
    },
  ];

  const first = await callGroq(firstMessages);
  try {
    return {
      svg: sanitizeAndOptimize(first.content),
      retried: false,
      model: first.model,
    };
  } catch (firstError) {
    let invalidPayload = first.content.slice(0, 8000);
    try {
      invalidPayload = extractSvg(first.content);
    } catch {
      /* keep raw */
    }

    const retry = await callGroq([
      ...firstMessages,
      { role: "assistant", content: invalidPayload },
      { role: "user", content: FIX_PROMPT },
    ]);

    try {
      return {
        svg: sanitizeAndOptimize(retry.content),
        retried: true,
        model: retry.model,
      };
    } catch (retryError) {
      const detail =
        (retryError && retryError.message) ||
        (firstError && firstError.message) ||
        "unknown error";
      throw new Error(`Model returned invalid SVG after retry. Last error: ${detail}`);
    }
  }
}

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

  const started = Date.now();

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
    const result = await generateSvgFromImage(
      prepared.imageBase64,
      prepared.mimeType,
    );

    res.status(200).json({
      svg: result.svg,
      meta: {
        elapsedMs: Date.now() - started,
        retried: result.retried,
        model: result.model,
        width: TARGET.widthMm,
        height: TARGET.heightMm,
        widthMeters: TARGET.widthMeters,
        heightMeters: TARGET.heightMeters,
        physicalSize: "1.5 m × 3 m",
        unit: "m",
        viewBox: TARGET.viewBox,
      },
    });
  } catch (error) {
    console.error("[api/generate-svg]", error);
    const message = error instanceof Error ? error.message : "Unexpected serverless error";
    const status =
      message.includes("GROQ_API_KEY") || message.includes("configured")
        ? 503
        : message.includes("invalid SVG")
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
