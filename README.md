# Sketch2SVG Camera

Capture or upload an image and turn it into a clean, editable **technical line
drawing** as SVG — single-stroke centerline paths, the way a CAD/blueprint drawing
reads. Fully deterministic (no LLM guessing), no API key, no per-request cost, and
it runs in tens of milliseconds.

Output canvas: **1.5 m × 3 m** (`viewBox="0 0 1500 3000"`, 1 unit = 1 mm).

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind, Framer Motion, PWA |
| API | Deterministic vectorizer via Express (local) / Vercel Serverless |
| Image / SVG | sharp, potrace, svgo, fast-xml-parser, zod |

## How it works

1. Capture or upload an image
2. `POST /generate-svg` with `{ imageBase64, mimeType, mode? }`
3. **sharp** normalizes contrast and resizes to grayscale
4. The server extracts a 1-px line image, then vectorizes it into stroke paths:
   - **line** — binarize dark pen/pencil ink (for sketches)
   - **edge** — Sobel edge detection of object contours (for photos / 3D renders)
   - lines are morphologically closed (bridging gaps), thinned to a 1-px skeleton
     (Zhang–Suen), traced into polylines, and simplified (Ramer–Douglas–Peucker)
5. The result is centered + scaled into the fixed 1.5 × 3 m canvas, optimized with
   **svgo**, and rendered in the browser

### Drawing modes

Pick a style in the UI, or send `mode` in the request:

| `mode` | Output |
| --- | --- |
| `technical` (default) | Centerline line drawing; auto-picks line vs. edge |
| `line` | Centerline drawing, forcing dark-ink extraction |
| `edge` | Centerline drawing, forcing edge extraction (photos, renders) |
| `silhouette` | Filled potrace trace (solid shapes, not lines) |

Because the pipeline is fully deterministic, the same image + mode always produces
the same SVG.

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
  "mimeType": "image/jpeg",
  "mode": "technical"
}
```

Response:

```json
{
  "svg": "<svg width=\"1.5m\" height=\"3m\" ...>",
  "meta": {
    "elapsedMs": 72,
    "physicalSize": "1.5 m × 3 m",
    "engine": "technical",
    "mode": "line",
    "strokeCount": 20
  }
}
```

### `GET /health`

Returns `{ ok: true, engine: "potrace" }`.

## Project layout

```
api/                 Vercel serverless functions
  _technical.js      Centerline vectorizer (line/edge → stroke paths)
  _tracer.js         potrace silhouette trace + shared canvas helpers
  generate-svg.js    HTTP handler (mode routing)
client/              Vite React PWA
server/              Local Express API (delegates to the api/ modules)
vercel.json          Vercel build + rewrites
.env.example         Env template (PORT / CORS only)
```

## Notes

- Camera requires HTTPS (Vercel provides this) or `localhost`.
- For the cleanest line drawing, use a well-lit image with clear outlines.
  If `technical` (auto) misjudges, force `line` (sketches) or `edge` (photos).
- Hobby plan function timeout is limited; Pro allows up to 60 s (`maxDuration` is set to 60).
