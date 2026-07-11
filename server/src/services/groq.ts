import Groq from "groq-sdk";
import { requireGroqApiKey } from "../env.js";
import { extractSvg, sanitizeAndOptimize } from "./svg.js";

const DEFAULT_MODEL = "qwen/qwen3.6-27b";

/** Primary prompt sent with the base64 image to Groq chat completions. */
export const CONVERT_PROMPT = `You are tracing a hand-drawn sketch into SVG with maximum geometric fidelity.

Task: Recreate EVERY visible stroke from the image as clean vector geometry.

Accuracy rules (critical):
- Trace what you see. Do NOT invent, omit, stylize, or "improve" the drawing.
- Preserve proportions, relative sizes, spacing, angles, and alignment exactly.
- Preserve the number of separate shapes/objects and their layout.
- Follow curved and straight lines carefully; keep corners where the sketch has corners.
- Ignore paper texture, shadows, glare, and background noise — only ink/pencil marks.
- Prefer many accurate path segments over a few oversimplified shapes.
- Use black strokes (#000), fill="none" unless a region is clearly filled in the sketch.
- Stroke width should match the visual weight of the lines (typically 8–28 in viewBox units).
- stroke-linecap="round" and stroke-linejoin="round" for hand-drawn feel.
- Center the drawing on the canvas with a modest margin; do not stretch or squash.

Canvas (required on root <svg>):
xmlns="http://www.w3.org/2000/svg"
width="1.5m"
height="3m"
viewBox="0 0 1500 3000"
(1 user unit = 1 mm; canvas is 1.5 m wide × 3 m tall)

Output rules:
- Return ONLY valid SVG XML starting with <svg and ending with </svg>
- No markdown, no code fences, no commentary, no thinking
- Use only: path, circle, ellipse, rect, polygon, polyline, line, g
- No raster images, scripts, filters, foreignObject, or external URLs`;

const FIX_PROMPT = `The previous SVG was invalid or incomplete. Fix it while staying faithful to the sketch.
Return ONLY valid SVG XML with:
xmlns="http://www.w3.org/2000/svg" width="1.5m" height="3m" viewBox="0 0 1500 3000"
Trace every visible line accurately. No markdown or explanation.`;
export interface GenerateSvgOptions {
  imageBase64: string;
  mimeType: string;
  model?: string;
}

export interface GenerateSvgResult {
  svg: string;
  retried: boolean;
  model: string;
  rawLength: number;
}

function getClient(): Groq {
  return new Groq({ apiKey: requireGroqApiKey() });
}

function getModel(): string {
  return process.env.GROQ_VISION_MODEL?.trim() || DEFAULT_MODEL;
}

function isQwenModel(model: string): boolean {
  return /qwen/i.test(model);
}

function preview(text: string, max = 280): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}

function collectMessageText(
  message: Groq.Chat.ChatCompletionMessage | undefined,
): string {
  if (!message) return "";

  const parts: string[] = [];
  if (typeof message.content === "string" && message.content.trim()) {
    parts.push(message.content);
  }

  const reasoning = (message as { reasoning?: string | null }).reasoning;
  if (typeof reasoning === "string" && reasoning.trim()) {
    parts.push(reasoning);
  }

  return parts.join("\n").trim();
}

async function callChatCompletions(
  client: Groq,
  model: string,
  messages: Groq.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    max_completion_tokens: 16384,
    top_p: 0.85,
    ...(isQwenModel(model)
      ? {
          reasoning_effort: "none" as const,
          reasoning_format: "parsed" as const,
        }
      : {
          reasoning_format: "parsed" as const,
        }),
  });

  const content = collectMessageText(completion.choices[0]?.message);
  if (!content) {
    const finish = completion.choices[0]?.finish_reason;
    throw new Error(
      `Empty response from Groq${finish ? ` (finish_reason=${finish})` : ""}`,
    );
  }
  return content;
}

/**
 * Send a base64 image to Groq chat completions and extract SVG from the reply.
 */
export async function generateSvgFromImage(
  options: GenerateSvgOptions,
): Promise<GenerateSvgResult> {
  const client = getClient();
  const model = options.model ?? getModel();
  const dataUrl = `data:${options.mimeType};base64,${options.imageBase64}`;

  const imagePart: Groq.Chat.ChatCompletionContentPart = {
    type: "image_url",
    image_url: { url: dataUrl },
  };

  const firstMessages: Groq.Chat.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: CONVERT_PROMPT },
        imagePart,
      ],
    },
  ];

  const firstRaw = await callChatCompletions(client, model, firstMessages);

  try {
    const svg = sanitizeAndOptimize(firstRaw);
    return {
      svg,
      retried: false,
      model,
      rawLength: firstRaw.length,
    };
  } catch (firstError) {
    console.warn(
      "[generate-svg] first pass failed:",
      firstError instanceof Error ? firstError.message : firstError,
      "| preview:",
      preview(firstRaw),
    );

    const invalidPayload = (() => {
      try {
        return extractSvg(firstRaw);
      } catch {
        return firstRaw.slice(0, 8000);
      }
    })();

    const retryMessages: Groq.Chat.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: CONVERT_PROMPT },
          imagePart,
        ],
      },
      { role: "assistant", content: invalidPayload },
      { role: "user", content: FIX_PROMPT },
    ];

    const retryRaw = await callChatCompletions(client, model, retryMessages);

    try {
      const svg = sanitizeAndOptimize(retryRaw);
      return {
        svg,
        retried: true,
        model,
        rawLength: retryRaw.length,
      };
    } catch (retryError) {
      console.error(
        "[generate-svg] retry failed:",
        retryError instanceof Error ? retryError.message : retryError,
        "| preview:",
        preview(retryRaw),
      );
      const detail =
        retryError instanceof Error
          ? retryError.message
          : firstError instanceof Error
            ? firstError.message
            : "unknown error";
      throw new Error(
        `Model returned invalid SVG after retry. Last error: ${detail}`,
      );
    }
  }
}
