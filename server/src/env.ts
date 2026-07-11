import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// On Vercel, env vars come from the project dashboard — skip local file loading.
if (!process.env.VERCEL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootEnv = path.resolve(__dirname, "../../.env");
  const serverEnv = path.resolve(__dirname, "../.env");
  dotenv.config({ path: rootEnv, override: true });
  dotenv.config({ path: serverEnv, override: false });
}
