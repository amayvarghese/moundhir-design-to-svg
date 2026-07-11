import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const key = process.env.GROQ_API_KEY?.trim();
  res.status(200).json({
    ok: true,
    service: "sketch2svg-server",
    model: process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b",
    groqConfigured: Boolean(key && key !== "your_groq_api_key_here"),
    platform: "vercel",
  });
}
