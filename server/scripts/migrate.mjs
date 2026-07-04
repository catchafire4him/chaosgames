// Apply the campaign schema to the database in DATABASE_URL.
//   node server/scripts/migrate.mjs
// Idempotent — safe to run repeatedly (CREATE ... IF NOT EXISTS everywhere).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

// load server/.env regardless of the cwd the script is invoked from
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (server/.env). Aborting.");
  process.exit(1);
}

const schemaPath = fileURLToPath(new URL("../src/storage/schema.sql", import.meta.url));
const sql = await readFile(schemaPath, "utf8");

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await pool.query(sql);
  const { rows } = await pool.query("SELECT version, applied_at FROM schema_version ORDER BY version");
  console.log("Migration OK. schema_version:", rows);
  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  );
  console.log("Tables:", tables.map((t) => t.table_name).join(", "));
} catch (err) {
  console.error("Migration FAILED:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
