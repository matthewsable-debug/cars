import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { DATA_DIR } from "../config/paths.js";

// Optional durable persistence backend.
//
// The platform's working data lives in JSON files under DATA_DIR. On hosts with
// an ephemeral filesystem, those files vanish on every redeploy. When a
// DATABASE_URL is configured, this module mirrors each saved blob to Postgres
// (write-through) and, on boot, restores any blob whose local file is missing
// (a fresh deploy) — so previously added dealers, watchlist entries, and seen
// listings survive redeploys anywhere.
//
// It is fully additive: with no DATABASE_URL, every function here is a no-op and
// the app behaves exactly as the file-only version (which is what a persistent
// disk relies on).

const KEYS = ["dealers", "watchlist", "listings"];

let pool = null;
let schemaReady = false;
const pending = new Set(); // in-flight write-through queries, for flush()

export function isEnabled() {
  return pool != null;
}

// Connect (if DATABASE_URL is set), ensure the schema, and restore any missing
// local files from the database. Safe to call more than once.
export async function init() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) return; // file-only mode
    pool = new pg.Pool({ connectionString: url, ssl: sslOption(url), max: 3 });
  }
  try {
    await ensureSchema();
    await restoreMissing();
    console.log("[durable] database persistence enabled");
  } catch (err) {
    console.error("[durable] init failed, continuing with file storage:", err.message);
    await close();
  }
}

// Test hook: inject a pg-compatible pool (e.g. pg-mem) without a DATABASE_URL.
export function configureForTest(injectedPool) {
  pool = injectedPool;
}

async function ensureSchema() {
  if (schemaReady) return; // create the table at most once per connection
  // value is stored as TEXT (a JSON string). We only ever read/write whole blobs
  // by key, so this is simpler and maximally portable across Postgres versions.
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  schemaReady = true;
}

// Restore a blob from the DB only when the local file is ABSENT, so we never
// clobber newer data on a persistent disk — we only fill in a blank deploy.
async function restoreMissing() {
  for (const key of KEYS) {
    const file = path.join(DATA_DIR, `${key}.json`);
    if (fs.existsSync(file)) continue;
    const value = await getBlob(key);
    if (value != null) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
      console.log(`[durable] restored ${key} from database`);
    }
  }
}

export async function getBlob(key) {
  if (!pool) return null;
  const { rows } = await pool.query("SELECT value FROM app_state WHERE key = $1", [key]);
  if (!rows.length) return null;
  const value = rows[0].value;
  return typeof value === "string" ? JSON.parse(value) : value;
}

// Write-through: mirror a blob to the database. Never throws — the local file
// write already succeeded, so a DB hiccup can't lose the current change or crash
// the caller. The in-flight promise is tracked so flush() can await it.
export function put(key, obj) {
  if (!pool) return;
  const p = pool
    .query(
      `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(obj), Date.now()]
    )
    .catch((err) => console.error(`[durable] failed to persist ${key}:`, err.message))
    .finally(() => pending.delete(p));
  pending.add(p);
}

// Wait for outstanding write-through queries to finish (use before exiting a
// short-lived process such as the CLI, so the last write reaches the DB).
export async function flush() {
  await Promise.allSettled([...pending]);
}

export async function close() {
  const current = pool;
  pool = null;
  schemaReady = false;
  if (current && current.end) {
    try {
      await current.end();
    } catch {
      /* already closed */
    }
  }
}

// Managed Postgres (Render/Fly/Heroku/etc.) typically needs SSL with a
// non-strict chain; disable for local/plain connections.
function sslOption(url) {
  if (process.env.PGSSLMODE === "disable" || process.env.DATABASE_SSL === "false") return false;
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return false;
  } catch {
    /* fall through */
  }
  return { rejectUnauthorized: false };
}
