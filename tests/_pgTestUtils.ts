import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export type PgConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  max?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
};

export function getPgConfigFromEnv(): PgConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    };
  }

  const requiredKeys = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
  ] as const;
  const missing = requiredKeys.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      [
        "Missing Postgres env vars.",
        `Required: ${requiredKeys.join(", ")}`,
        `Missing: ${missing.join(", ")}`,
      ].join(" ")
    );
  }

  const rawHost = process.env.PGHOST as string;
  const host = rawHost === "localhost" ? "127.0.0.1" : rawHost;
  const port = Number(process.env.PGPORT);

  if (!Number.isFinite(port)) {
    throw new Error(`Invalid PGPORT: "${process.env.PGPORT}"`);
  }

  return {
    host,
    port,
    user: process.env.PGUSER as string,
    password: process.env.PGPASSWORD as string,
    database: process.env.PGDATABASE as string,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
  };
}

export async function applySchema(pool: Pool) {
  const schemaPath = path.resolve(process.cwd(), "sql/001_init.sql");
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
}

// Nomi tabelle coerenti con src/sss/db/repository.ts
const T_SESSIONS = "sessions";
const T_EVENTS = "session_events";
const T_SNAPSHOTS = "session_snapshots";

export async function assertSchemaReady(pool: Pool) {
  try {
    await pool.query(`SELECT 1 FROM ${T_SESSIONS} LIMIT 1;`);
    await pool.query(`SELECT 1 FROM ${T_EVENTS} LIMIT 1;`);
    await pool.query(`SELECT 1 FROM ${T_SNAPSHOTS} LIMIT 1;`);
  } catch {
    throw new Error(
      [
        "Postgres schema non trovato (mancano le tabelle sessions/session_events/session_snapshots).",
        "Applica lo schema UNA VOLTA (fuori dai test) con:",
        "  docker exec -i sss-postgres psql -U postgres -d sss_test < .\\sql\\001_init.sql",
      ].join("\n")
    );
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPostgres(
  pool: Pool,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const start = Date.now();
  let interval = opts.intervalMs ?? 250;
  let lastErr: unknown = null;

  while (Date.now() - start < timeoutMs) {
    try {
      await pool.query("SELECT 1;");
      return;
    } catch (err) {
      lastErr = err;
      await sleep(interval);
      interval = Math.min(1000, Math.floor(interval * 1.5));
    }
  }

  throw new Error(
    `Postgres not ready after ${timeoutMs}ms. Last error: ${String(lastErr)}`
  );
}
