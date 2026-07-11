import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleGenerateSvgRequest } from "../lib/generateHandler";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const result = await handleGenerateSvgRequest(req.body ?? {});
    if (!result.ok) {
      res.status(result.error.status).json({
        error: result.error.error,
        ...(result.error.details ? { details: result.error.details } : {}),
      });
      return;
    }

    res.status(200).json(result.data);
  } catch (error) {
    console.error("[api/generate-svg]", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Unexpected serverless error",
    });
  }
}
