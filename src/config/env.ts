const DEFAULT_DEV_DATABASE_URL =
  "postgres://postgres:postgres@127.0.0.1:5433/sss_test";

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  if ((process.env.NODE_ENV ?? "development") !== "production") {
    return DEFAULT_DEV_DATABASE_URL;
  }
  throw new Error(
    "DATABASE_URL is required in production (example: postgres://user:pass@host:5432/db)"
  );
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 3000),
  SSS_REPO:
    process.env.SSS_REPO ?? ((process.env.NODE_ENV ?? "development") === "test" ? "inmem" : "pg"),

  // Example: postgres://user:pass@127.0.0.1:5432/sss
  DATABASE_URL: resolveDatabaseUrl(),

  // Snapshot policy: save a snapshot every N events (e.g. 20)
  SNAPSHOT_EVERY: Number(process.env.SNAPSHOT_EVERY ?? 25),
};

export function getMaskedDatabaseLogInfo(
  rawConnectionString: string
): {
  connectionString: string;
  host: string;
  port: string;
  db: string;
  user: string;
} {
  const parsed = new URL(rawConnectionString);
  const password = parsed.password ? "***" : "";
  const authUser = parsed.username || "unknown";
  const auth = password ? `${authUser}:${password}` : authUser;
  const host = parsed.hostname || "unknown";
  const port = parsed.port || "5432";
  const db = parsed.pathname.replace(/^\//, "") || "unknown";
  return {
    connectionString: `${parsed.protocol}//${auth}@${host}:${port}/${db}`,
    host,
    port,
    db,
    user: authUser,
  };
}
