import "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { generateSvgRouter } from "./routes/generateSvg.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3001;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: [clientOrigin, "http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sketch2svg-server",
    engine: "potrace",
  });
});

app.use("/generate-svg", generateSvgRouter);

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));

app.get("/{*path}", (req, res, next) => {
  if (req.path.startsWith("/generate-svg") || req.path.startsWith("/health")) {
    next();
    return;
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[unhandled]", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  },
);

app.listen(port, () => {
  console.log(`Sketch2SVG server listening on http://localhost:${port}`);
  console.log("Tracing engine: potrace (no API key required)");
});
