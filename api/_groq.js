/**
 * Clean, professional SVG via a Groq vision instruct model.
 *
 * The deterministic tracer reproduces the ink exactly (wobbles and all). This
 * path instead asks a vision model to *interpret* the sketch and redraw it with
 * exact geometric primitives — clean rectangles, triangles, circles with correct
 * edges. We crop to the drawing first (so the model isn't distracted by the
 * background), then sanitize and canvas-fit whatever SVG it returns.
 */
const { isolateDrawingImage } = require("./_technical");
const { applyTargetCanvas, isValidSvg, optimizeSvg } = require("./_tracer");

const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const PROMPT = `You are a precise technical vector illustrator. The image is a hand-drawn sketch (photographed). Ignore the paper, background, shadows and any printed text — reproduce ONLY the hand-drawn ink sketch.

Redraw it as a CLEAN, PROFESSIONAL SVG built from exact geometric primitives: <rect>, <circle>, <ellipse>, <polygon>, <line>, <path>.

Rules:
- Reproduce every distinct shape, and the correct NUMBER of shapes, with faithful position, size, orientation and alignment.
- Idealize the geometry: a hand-drawn square becomes a perfect axis-aligned <rect>; a triangle becomes a clean 3-point <polygon>; a circle becomes a true <circle>.
- Preserve relative sizes and placement. Shapes drawn INSIDE another shape must stay fully inside it and keep their real (usually small) size — do not enlarge them or let them overflow.
- Keep proportions and spacing similar to the drawing. Do not add, remove, merge or stylize shapes.
- stroke="#111", fill="none", stroke-width="3", stroke-linejoin="round", stroke-linecap="round".
- Use viewBox="0 0 300 300" and center the drawing with a comfortable margin.
- Output ONLY the SVG markup, starting with <svg and ending with </svg>. No markdown, no code fences, no commentary.`;

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
  const fence = text.match(/```(?:svg|xml|html)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/<svg\b/i);
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model did not return an SVG");
  }
  return text.slice(start, end + "</svg>".length).trim();
}

// Strip anything unsafe/raster the model might emit; keep clean vector shapes.
function sanitize(svg) {
  const forbidden = [
    /<script[\s>]/i,
    /<foreignObject[\s>]/i,
    /<image[\s>]/i,
    /\son\w+\s*=/i,
    /javascript:/i,
    /href\s*=\s*["']\s*(?!#)[a-z]+:/i,
  ];
  for (const re of forbidden) {
    if (re.test(svg)) throw new Error("Model returned unsafe SVG");
  }
  return svg;
}

async function callGroqForSvg(imageBase64, mimeType, model) {
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireGroqApiKey()}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_completion_tokens: 2500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json && json.error && json.error.message) ||
      `Groq API error (${res.status})`;
    throw new Error(msg);
  }
  const content = json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content
    : "";
  if (!content) throw new Error("Empty response from Groq");
  return content;
}

/**
 * @returns {Promise<{ svg: string, meta: object }>}
 */
async function generateSvgWithGroq(imageBase64, mimeType, options = {}) {
  const started = Date.now();
  // Only honor an override that is actually a vision model; otherwise use the
  // Llama 4 default (older configs may still point at a text-only model).
  const configured = (process.env.GROQ_VISION_MODEL || "").trim();
  const model = /llama-4/i.test(configured) ? configured : DEFAULT_MODEL;

  // Focus the model on the drawing itself.
  let cropped = false;
  let imgB64 = imageBase64;
  let imgMime = mimeType;
  if (options.isolate !== false) {
    try {
      const iso = await isolateDrawingImage(imageBase64);
      imgB64 = iso.imageBase64;
      imgMime = iso.mimeType;
      cropped = iso.cropped;
    } catch {
      /* fall back to the original image */
    }
  }

  const raw = await callGroqForSvg(imgB64, imgMime, model);
  let svg = sanitize(extractSvg(raw));
  svg = optimizeSvg(svg);

  let canvased = applyTargetCanvas(svg, null);
  if (!isValidSvg(canvased)) throw new Error("Groq SVG failed validation");

  return {
    svg: canvased,
    meta: {
      elapsedMs: Date.now() - started,
      engine: "groq",
      model,
      isolated: cropped,
    },
  };
}

module.exports = { generateSvgWithGroq };
