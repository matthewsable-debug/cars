import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Verifies the database-backed durability layer against an in-memory Postgres
// (pg-mem): write-through mirroring and boot-time restore of a missing file
// (the "fresh deploy" case). Uses a scratch DATA_DIR so it touches no real data.

test("write-through mirrors saves and restores missing files on boot", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cars-durable-"));
  process.env.DATA_DIR = tmp; // read by config/paths.js on import below

  const { newDb } = await import("pg-mem");
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  // Fresh module instance so it picks up the scratch DATA_DIR.
  const durable = await import("../src/core/durable.js?case=writethrough");
  durable.configureForTest(pool);
  await durable.init(); // ensures schema; nothing to restore yet

  // A save() mirrors the blob to the DB.
  durable.put("dealers", { dealers: [{ id: "copley-west", name: "Copley West" }] });
  await durable.flush();

  const stored = await durable.getBlob("dealers");
  assert.deepEqual(stored, { dealers: [{ id: "copley-west", name: "Copley West" }] });

  // Simulate a fresh deploy: the local file doesn't exist yet.
  const file = path.join(tmp, "dealers.json");
  assert.ok(!fs.existsSync(file));

  // Boot restore recreates the file from the database.
  await durable.init();
  assert.ok(fs.existsSync(file), "file restored from DB");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    dealers: [{ id: "copley-west", name: "Copley West" }],
  });

  // Restore must NOT clobber an existing (possibly newer) local file.
  fs.writeFileSync(file, JSON.stringify({ dealers: [{ id: "local-only" }] }));
  await durable.init();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { dealers: [{ id: "local-only" }] });

  await durable.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("with no database configured, durable is a no-op", async () => {
  const durable = await import("../src/core/durable.js?case=noop");
  assert.equal(durable.isEnabled(), false);
  // put/flush/close must be safe to call with no backend.
  durable.put("dealers", { dealers: [] });
  await durable.flush();
  await durable.close();
  assert.equal(await durable.getBlob("dealers"), null);
});
