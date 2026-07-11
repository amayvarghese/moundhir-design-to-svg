import { Router, type Request, type Response } from "express";
import { handleGenerateSvgRequest } from "../services/generateHandler.js";

export const generateSvgRouter = Router();

generateSvgRouter.post("/", async (req: Request, res: Response) => {
  const result = await handleGenerateSvgRequest(req.body);
  if (!result.ok) {
    res.status(result.error.status).json({
      error: result.error.error,
      ...(result.error.details ? { details: result.error.details } : {}),
    });
    return;
  }
  res.json(result.data);
});
