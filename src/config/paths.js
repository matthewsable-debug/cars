import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the platform persists its JSON databases (listings, dealers, watchlist)
// and the email outbox. Override with the DATA_DIR env var so a deployment can
// point it at a mounted persistent disk (e.g. /data on Render/Fly). Defaults to
// the repo's ./data directory for local development.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "..", "data");
