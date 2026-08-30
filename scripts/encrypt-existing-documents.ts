/**
 * Encrypt the identity data already in the database.
 *
 *   npx tsx --env-file=.env scripts/encrypt-existing-documents.ts          # report only
 *   npx tsx --env-file=.env scripts/encrypt-existing-documents.ts --apply  # write
 *
 * server/fieldCrypto.ts encrypts everything written from now on, and reads any
 * row without the `enc:v1:` prefix back unchanged — so the app works during the
 * transition. That tolerance is also the hole: nothing can tell a row that
 * predates encryption from one that somehow escaped it. This closes the hole by
 * leaving no unprefixed rows behind.
 *
 * Three tables, because they hold the same Aadhaar between them and the comment
 * on add_identity_verifications.sql is right that encrypting one while the
 * others sit in the clear buys nothing:
 *
 *   account_documents      document_no, file_data
 *   identity_verifications document_no
 *   kyc_documents          document_no, file_data
 *
 * Safe to re-run: encryptField returns an already-encrypted value untouched, so
 * a second pass is a no-op rather than a double-wrap.
 *
 * Rows are read, encrypted and written one at a time rather than in a single
 * transaction. A document is megabytes of base64 and there can be many; the
 * write is idempotent per row, so an interrupted run is resumed by running it
 * again, not rolled back.
 */

import pg from "pg";
import { getPgPoolConfig } from "../server/pgPoolConfig.js";
import { encryptField, isEncrypted, assertFieldCryptoConfigured } from "../server/fieldCrypto.js";

/** Mirrors scripts/check-migrations.ts — same stale-pooler fallback. */
async function connect(): Promise<{ pool: pg.Pool; client: pg.PoolClient }> {
  const pool = new pg.Pool(getPgPoolConfig());
  try {
    return { pool, client: await pool.connect() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("tenant/user")) throw error;
    await pool.end().catch(() => {});
    const url = new URL(process.env.DATABASE_URL ?? "");
    const ref = url.username.split(".")[1];
    if (!ref) throw error;
    const direct = new pg.Pool({
      host: `db.${ref}.supabase.co`,
      port: 5432,
      user: "postgres",
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "") || "postgres",
      ssl: { rejectUnauthorized: false },
      family: 4,
    });
    return { pool: direct, client: await direct.connect() };
  }
}

interface Target {
  table: string;
  columns: string[];
}

const TARGETS: Target[] = [
  { table: "account_documents", columns: ["document_no", "file_data"] },
  { table: "identity_verifications", columns: ["document_no"] },
  { table: "kyc_documents", columns: ["document_no", "file_data"] },
];

const apply = process.argv.includes("--apply");

const { pool, client } = await connect();
let totalPlaintext = 0;
let totalEncrypted = 0;

try {
  assertFieldCryptoConfigured();
  console.log(apply ? "MODE: apply (will write)\n" : "MODE: report only (pass --apply to write)\n");

  for (const target of TARGETS) {
    const { rows: exists } = await client.query<{ present: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`public.${target.table}`]
    );
    if (!exists[0]?.present) {
      console.log(`${target.table}: table not present, skipping`);
      continue;
    }

    const { rows } = await client.query<Record<string, string | null>>(
      `SELECT id, ${target.columns.join(", ")} FROM public.${target.table}`
    );

    let plaintext = 0;
    let encrypted = 0;

    for (const row of rows) {
      const updates: string[] = [];
      const values: unknown[] = [];

      for (const column of target.columns) {
        const value = row[column];
        // NULL and empty columns hold nothing to protect.
        if (value === null || value === "") continue;
        if (isEncrypted(value)) continue;
        plaintext++;
        if (!apply) continue;
        values.push(encryptField(value));
        updates.push(`${column} = $${values.length}`);
      }

      if (updates.length === 0) continue;
      values.push(row.id);
      await client.query(
        `UPDATE public.${target.table} SET ${updates.join(", ")} WHERE id = $${values.length}`,
        values
      );
      encrypted += updates.length;
    }

    totalPlaintext += plaintext;
    totalEncrypted += encrypted;
    console.log(
      `${target.table.padEnd(24)} ${rows.length} row(s), ` +
        `${plaintext} plaintext value(s)` +
        (apply ? ` -> ${encrypted} encrypted` : "")
    );
  }

  console.log("");
  if (!apply) {
    console.log(
      totalPlaintext === 0
        ? "Nothing to do: every identity value is already encrypted."
        : `${totalPlaintext} value(s) would be encrypted. Re-run with --apply.`
    );
  } else {
    console.log(`Encrypted ${totalEncrypted} value(s).`);
    // Prove it rather than assume it: a second pass must find nothing.
    let remaining = 0;
    for (const target of TARGETS) {
      const { rows: exists } = await client.query<{ present: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS present`,
        [`public.${target.table}`]
      );
      if (!exists[0]?.present) continue;
      const checks = target.columns
        .map((c) => `(${c} IS NOT NULL AND ${c} <> '' AND ${c} NOT LIKE 'enc:v1:%')`)
        .join(" OR ");
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${target.table} WHERE ${checks}`
      );
      const n = Number(rows[0]?.n ?? "0");
      remaining += n;
      if (n > 0) console.log(`  STILL PLAINTEXT: ${target.table} — ${n} row(s)`);
    }
    console.log(
      remaining === 0
        ? "Verified: no plaintext identity values remain."
        : `WARNING: ${remaining} row(s) still plaintext. Re-run.`
    );
    process.exitCode = remaining === 0 ? 0 : 1;
  }
} finally {
  client.release();
  await pool.end();
}
