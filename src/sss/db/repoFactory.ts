import { Pool } from "pg";
import { env } from "../../config/env";
import { InMemorySssRepository } from "./__mocks__/inMemorySssRepository";
import { SssRepository } from "./repository";

export type RepoType = "inmem" | "pg";

export function createRepositoryFromEnv(): {
  repo: SssRepository;
  close?: () => Promise<void>;
} {
  const repoType = env.SSS_REPO as RepoType;

  if (repoType === "pg") {
    const pool = new Pool(getPgConfigFromEnv());
    return {
      repo: new SssRepository(pool),
      close: () => pool.end(),
    };
  }

  return { repo: new InMemorySssRepository() };
}

function getPgConfigFromEnv() {
  if (env.DATABASE_URL) {
    return {
      connectionString: env.DATABASE_URL,
    };
  }

  const requiredKeys = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;
  const missing = requiredKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Postgres env vars for SSS_REPO=pg. Missing: ${missing.join(", ")}`
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
  };
}
