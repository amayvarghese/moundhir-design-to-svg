import Groq from "groq-sdk";
import { requireGroqApiKey } from "../env.js";
import { extractSvg, sanitizeAndOptimize } from "./svg.js";

const DEFAULT_MODEL = "qwen/qwen3.6-27b";

/** Primary prompt sent with the base64 image to Groq chat completions. */
export const CONVERT_PROMPT =
  "Convert this hand-drawn sketch into clean SVG code. Output only the SVG. Use a 1.5m × 3m canvas: width=\"1.5m\" height=\"3m\" viewBox=\"0 0 1500 3000\".";

const FIX_PROMPT =
  "Fix this SVG. Return only valid SVG XML with width=\"1.5m\" height=\"3m\" viewBox=\"0 0 1500 3000\".";

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
    temperature: 0.1,
    max_completion_tokens: 16384,
    top_p: 0.9,
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
