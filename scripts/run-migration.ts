/**
 * Apply a migration file to DATABASE_URL.
 *
 *   npx tsx --env-file=.env scripts/run-migration.ts migrations/add_identity_verifications.sql
 *   npx tsx --env-file=.env scripts/run-migration.ts migrations/*.sql
 *
 * Exists because psql is not installed on every machine that has to run these,
 * and the Supabase SQL editor gives no ordering help — it just fails on the
 * first missing relation.
 *
 * The whole file goes to the server in one call, so a file that is one
 * statement stays one statement and a DO block stays intact. Postgres runs a
 * multi-statement simple query as a single implicit transaction, so a failure
 * part-way leaves nothing half-applied.
 *
 * Every migration in this directory is written to be idempotent, so re-running
 * one is not an error.
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { assertDatabaseUrl, getPgPoolConfig } from "../server/pgPoolConfig.js";

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: run-migration.ts <file.sql> [more.sql ...]");
    process.exit(1);
  }
  try {
    // Same validation the server does at boot, so a placeholder host fails
    // here with the same sentence rather than a DNS error.
    assertDatabaseUrl();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const client = new Client(getPgPoolConfig());

  // NOTICEs are how these migrations report a skipped no-op, so they are the
  // interesting output rather than noise to swallow.
  client.on("notice", (msg) => console.log(`   notice: ${msg.message}`));

  await client.connect();
  try {
    for (const file of files) {
      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) {
        console.error(`No such file: ${resolved}`);
        process.exitCode = 1;
        continue;
      }
      process.stdout.write(`-> ${path.basename(resolved)}\n`);
      try {
        await client.query(fs.readFileSync(resolved, "utf8"));
        console.log("   ok\n");
      } catch (err) {
        console.error(`   FAILED: ${err instanceof Error ? err.message : err}\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    await client.end();
  }
}

void main();
