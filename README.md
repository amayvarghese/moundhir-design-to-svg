# Sketch2SVG Camera

Capture hand-drawn sketches with your camera and convert them into clean, editable
SVG using **potrace** — the same deterministic raster-to-vector engine Inkscape
uses. The output traces the actual pixels of your drawing, so it looks like the
photo, not a model's guess. No API key, no per-request cost.

Output canvas: **1.5 m × 3 m** (`viewBox="0 0 1500 3000"`, 1 unit = 1 mm).

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind, Framer Motion, PWA |
| API | potrace tracing via Express (local) / Vercel Serverless |
| Image / SVG | sharp, potrace, svgo, fast-xml-parser, zod |

## How it works

1. Capture or upload an image
2. Convert to base64 and `POST /generate-svg` with `{ imageBase64, mimeType }`
3. The server cleans the photo with **sharp** (grayscale, contrast normalize,
   despeckle) so the ink stands out from the paper
4. **potrace** vectorizes the black/white image into crisp vector paths
5. The result is centered and scaled into the fixed 1.5 × 3 m canvas, optimized
   with **svgo**, and rendered in the browser

Because the pipeline is fully deterministic, the same drawing always produces the
same SVG — and it runs in tens of milliseconds.

## Local development

```bash
cp .env.example .env   # optional — only sets PORT / CORS origin

npm install
npm run install:all
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:3001

No API keys are required.

## Deploy to Vercel

### 1. Push to GitHub

This repo lives at:
[https://github.com/amayvarghese/moundhir-design-to-svg](https://github.com/amayvarghese/moundhir-design-to-svg)

### 2. Import in Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import **`amayvarghese/moundhir-design-to-svg`**
3. Framework Preset: **Other** (or leave blank — `vercel.json` configures the build)
4. Root Directory: **`.`** (repository root)
5. Build settings are already in `vercel.json`:
   - Install: `npm install && npm run install:all`
   - Build: `npm run build --prefix client`
   - Output: `client/dist`

### 3. Environment variables

None required for tracing. `vercel.json` allocates the tracer function 1 GB of
memory and a 60 s `maxDuration`.

### 4. Deploy

Click **Deploy**. After it finishes, open the Vercel URL and allow camera access
(HTTPS is required for camera).

### 5. Optional: custom domain

Project → Settings → Domains → add your domain.

## API

### `POST /generate-svg`

```json
{
  "imageBase64": "<base64 without data-URL prefix>",
  "mimeType": "image/jpeg"
}
```

Response:

```json
{
  "svg": "<svg width=\"1.5m\" height=\"3m\" ...>",
  "meta": {
    "elapsedMs": 79,
    "physicalSize": "1.5 m × 3 m",
    "engine": "potrace",
    "model": "potrace"
  }
}
```

### `GET /health`

Returns `{ ok: true, engine: "potrace" }`.

## Project layout

```
api/                 Vercel serverless functions (api/_tracer.js = pipeline)
client/              Vite React PWA
server/              Local Express API (server/src/services/tracer.ts)
vercel.json          Vercel build + rewrites
.env.example         Env template (PORT / CORS only)
```

## Notes

- Camera requires HTTPS (Vercel provides this) or `localhost`.
- For the cleanest trace, use a well-lit photo of a dark-ink drawing on light paper.
- Hobby plan function timeout is limited; Pro allows up to 60 s (`maxDuration` is set to 60).
