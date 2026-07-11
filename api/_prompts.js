/** High-fidelity sketch→SVG instructions for Groq vision. */
const CONVERT_PROMPT = `You are tracing a hand-drawn sketch into SVG with maximum geometric fidelity.

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

module.exports = { CONVERT_PROMPT, FIX_PROMPT };
