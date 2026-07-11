export default function handler(
  _req: { method?: string },
  res: {
    setHeader: (k: string, v: string) => void;
    status: (n: number) => { json: (b: unknown) => void };
  },
) {
  const key = process.env.GROQ_API_KEY?.trim();
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    ok: true,
    service: "sketch2svg-server",
    model: process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b",
    groqConfigured: Boolean(key && key !== "your_groq_api_key_here"),
    platform: "vercel",
  });
}
