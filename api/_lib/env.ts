export function requireGroqApiKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key || key === "your_groq_api_key_here") {
    throw new Error(
      "GROQ_API_KEY is not configured. Set it in Vercel Project Settings → Environment Variables.",
    );
  }
  return key;
}
