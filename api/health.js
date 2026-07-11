/** @type {import('@vercel/node').VercelApiHandler} */
module.exports = function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({
      ok: true,
      service: "sketch2svg-server",
      engine: "potrace",
      platform: "vercel",
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "health failed",
    });
  }
};
