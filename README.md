# Sketch2SVG Camera

Capture hand-drawn sketches with your camera and convert them into clean, editable SVG using Groq Vision (`qwen/qwen3.6-27b`).

Output canvas: **1.5 m × 3 m** (`viewBox="0 0 1500 3000"`).

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind, Framer Motion, PWA |
| API | Groq chat completions (vision) via Express (local) / Vercel Serverless |
| Image / SVG | sharp, svgo, fast-xml-parser, zod |

## Flow

1. Capture or upload an image  
2. Convert to base64  
3. `POST /generate-svg` with `{ imageBase64, mimeType }`  
4. Server calls Groq chat completions  
5. Extract SVG → fit to 1.5×3 m → render in the browser  

## Local development

```bash
cp .env.example .env
# Add GROQ_API_KEY from https://console.groq.com/keys

npm install
npm run install:all
npm run dev
```

- App: http://localhost:5173  
- API: http://localhost:3001  

## Deploy to Vercel

### 1. Push to GitHub

This repo is meant to live at:
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

In **Project → Settings → Environment Variables**, add:

| Name | Value | Environments |
| --- | --- | --- |
| `GROQ_API_KEY` | your Groq API key | Production, Preview, Development |
| `GROQ_VISION_MODEL` | `qwen/qwen3.6-27b` (optional) | Production, Preview, Development |

### 4. Deploy

Click **Deploy**. After it finishes, open the Vercel URL and allow camera access (HTTPS is required for camera).

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
    "elapsedMs": 1234,
    "physicalSize": "1.5 m × 3 m",
    "model": "qwen/qwen3.6-27b"
  }
}
```

### `GET /health`

Health check + whether `GROQ_API_KEY` is configured.

## Project layout

```
api/                 Vercel serverless functions
client/              Vite React PWA
server/              Local Express API (same services)
vercel.json          Vercel build + rewrites
.env.example         Env template (never commit real keys)
```

## Notes

- Never commit `.env` — keys belong in Vercel Environment Variables.  
- Camera requires HTTPS (Vercel provides this) or `localhost`.  
- Hobby plan function timeout is limited; Pro allows up to 60s (`maxDuration` is set to 60).  
