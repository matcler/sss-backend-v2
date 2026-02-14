import { Pool } from "pg";
import { env } from "../../config/env";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });
  return pool;
}
