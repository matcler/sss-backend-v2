import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { Pool, PoolClient } from "pg";
import { execSync } from "node:child_process";
import { SssRepository } from "../src/sss/db/repository";
import { ConflictError } from "../src/sss/domain/errors";
import { makeInitialSnapshot } from "../src/sss/domain/snapshot";
import { SssService } from "../src/sss/service/sss.service";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";
import {
  applySchema,
  assertSchemaReady,
  getPgConfigFromEnv,
  waitForPostgres,
} from "./_pgTestUtils";

// Integration tests: require Postgres. Enable explicitly via RUN_PG_TESTS/RUN_PG_TESTS_TC.
const runPg = process.env.RUN_PG_TESTS === "true";
const runTc = process.env.RUN_PG_TESTS_TC === "true";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerOk = isDockerAvailable();
const enableTcSuite = runTc && dockerOk;

// Nomi tabelle coerenti con src/sss/db/repository.ts
const T_SESSIONS = "sessions";
const T_EVENTS = "session_events";
const T_SNAPSHOTS = "session_snapshots";

async function truncateAll(pool: Pool) {
  // Ordine non critico con CASCADE, ma teniamo pulito
  await pool.query(
    `TRUNCATE ${T_EVENTS}, ${T_SNAPSHOTS}, ${T_SESSIONS} RESTART IDENTITY CASCADE;`
  );
}

function defineRepositoryContractTests(getPool: () => Pool) {
  const sessionId = `test-session-${Date.now()}`;
  const ruleset = "dnd5e";
  let pool: Pool;
  let repo: SssRepository;

  beforeAll(() => {
    pool = getPool();
    repo = new SssRepository(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  it("getState con snapshot: replay solo eventi > snapshot.version e meta.version arriva alla testa stream", async () => {
    const session_id = `S_PG_GETSTATE_${Date.now()}`;

    await repo.withTx(async (client) => {
      await repo.insertSessionIfMissing(client, session_id, "default");

      const events = Array.from({ length: 30 }, () => ({
        type: "MODE_SET",
        payload: { mode: "EXPLORATION" },
        version: 0,
      }));

      await repo.appendEvents(client, session_id, 0, events as any);

      const snap = makeInitialSnapshot(session_id, "default");
      snap.meta.version = 10;
      await repo.saveSnapshot(client, snap);
    });

    const sss = new SssService(repo as any, allowAllRuleEngine, 25);

    const state = await sss.getState(session_id);

    expect(state.meta.session_id).toBe(session_id);
    expect(state.meta.version).toBe(30);
  });

  it("roundtrip: append preserves ordering and versions (first event is v1)", async () => {
    await repo.withTx(async (client: PoolClient) => {
      await repo.insertSessionIfMissing(client, sessionId, ruleset);

      // Nel tuo repo: stream vuoto => currentVersion = 0
      // quindi expected_version iniziale deve essere 0
      await repo.appendEvents(client, sessionId, 0, [
        { type: "SESSION_CREATED", payload: { name: "S" } } as any,
        { type: "ZONE_ADDED", payload: { zoneId: "z1" } } as any,
      ]);
    });

    const events = (await repo.withTx((client: PoolClient) =>
      (repo as any).getEventsInRange(client, sessionId)
    )) as any[];

    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe("SESSION_CREATED");
    expect(events[1].event_type).toBe("ZONE_ADDED");

    // IMPORTANT: nel tuo repo, il primo evento su stream vuoto diventa version 1 (non 0)
    expect(events[0].version).toBe(1);
    expect(events[1].version).toBe(2);
  });

  it("stale expected_version -> ConflictError and no write", async () => {
    await repo.withTx(async (client: PoolClient) => {
      await repo.insertSessionIfMissing(client, sessionId, ruleset);

      await repo.appendEvents(client, sessionId, 0, [
        { type: "SESSION_CREATED", payload: {} } as any, // -> v1
        { type: "ZONE_ADDED", payload: { zoneId: "z1" } } as any, // -> v2
      ]);
    });

    // Ora currentVersion = 2
    await expect(
      repo.withTx(async (client: PoolClient) => {
        await repo.appendEvents(client, sessionId, 1, [
          { type: "ENTITY_ADDED", payload: { entityId: "e1" } } as any,
        ]);
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // Conferma che non ha scritto nulla
    const events = (await repo.withTx((client: PoolClient) =>
      (repo as any).getEventsInRange(client, sessionId)
    )) as any[];
    expect(events).toHaveLength(2);
    expect(events.map((e: any) => e.event_type)).toEqual([
      "SESSION_CREATED",
      "ZONE_ADDED",
    ]);
    expect(events.map((e: any) => e.version)).toEqual([1, 2]);
  });

  it("race safety: concurrent appends with same expected_version -> one wins, other ConflictError (23505 mapped)", async () => {
    // Porta stream a currentVersion=1 (un evento scritto a v1)
    await repo.withTx(async (client: PoolClient) => {
      await repo.insertSessionIfMissing(client, sessionId, ruleset);
      await repo.appendEvents(client, sessionId, 0, [
        { type: "SESSION_CREATED", payload: {} } as any, // -> v1
      ]);
    });

    // Due append concorrenti con expected_version=1:
    // entrambi proveranno a scrivere v2; uno deve fallire su unique (23505) -> ConflictError
    const p1 = repo.withTx((client: PoolClient) =>
      repo.appendEvents(client, sessionId, 1, [
        { type: "ZONE_ADDED", payload: { zoneId: "z1" } } as any,
      ])
    );

    const p2 = repo.withTx((client: PoolClient) =>
      repo.appendEvents(client, sessionId, 1, [
        { type: "ZONE_ADDED", payload: { zoneId: "z2" } } as any,
      ])
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reason: any = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ConflictError);

    const events = (await repo.withTx((client: PoolClient) =>
      (repo as any).getEventsInRange(client, sessionId)
    )) as any[];

    // SESSION_CREATED (v1) + uno dei due ZONE_ADDED (v2)
    expect(events).toHaveLength(2);
    expect(events[0].version).toBe(1);
    expect(events[1].version).toBe(2);
    expect(events[0].event_type).toBe("SESSION_CREATED");
    expect(events[1].event_type).toBe("ZONE_ADDED");
  });
}

describe.skipIf(!runPg)(
  "Postgres repository contract (external) (versioning + optimistic concurrency)",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool(getPgConfigFromEnv());
      await waitForPostgres(pool, { timeoutMs: 30000 });
      try {
        await assertSchemaReady(pool);
      } catch (err) {
        try {
          await applySchema(pool);
          await assertSchemaReady(pool);
        } catch (applyErr) {
          throw new Error(
            [
              "Failed to apply Postgres schema for external tests.",
              `Original error: ${String(err)}`,
              `Apply error: ${String(applyErr)}`,
              "Check DB credentials and that sql/001_init.sql is accessible.",
            ].join(" ")
          );
        }
      }
    });

    afterAll(async () => {
      await pool.end();
    });

    defineRepositoryContractTests(() => pool);
  }
);

describe.runIf(enableTcSuite)(
  "Postgres repository contract (testcontainers) (versioning + optimistic concurrency)",
  () => {
    let pool: Pool;
    let container: any;

    beforeAll(
      async () => {
        const { GenericContainer, Wait } = await import("testcontainers");
        const database = "sss_test";
        const user = "postgres";
        const password = "postgres";

        container = await new GenericContainer("postgres:16-alpine")
          .withEnvironment({
            POSTGRES_DB: database,
            POSTGRES_USER: user,
            POSTGRES_PASSWORD: password,
          })
          .withExposedPorts(5432)
          .withWaitStrategy(
            Wait.forLogMessage(/database system is ready to accept connections/i)
          )
          .start();

        const host = container.getHost();
        const port = container.getMappedPort(5432);

        pool = new Pool({
          host,
          port,
          user,
          password,
          database,
          max: 2,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 5000,
        });

        await waitForPostgres(pool, { timeoutMs: 30000 });
        await applySchema(pool);
        await assertSchemaReady(pool);
      },
      60_000
    );

    afterAll(async () => {
      try {
        await pool?.end();
      } catch {
        // ignore
      } finally {
        await container?.stop();
      }
    });

    defineRepositoryContractTests(() => pool);
  }
);

if (runTc && !dockerOk) {
  describe("Postgres repository contract (testcontainers)", () => {
    it.skip(
      "Skipping Testcontainers suite: Docker runtime not available. Start Docker Desktop or configure a container runtime.",
      () => {}
    );
  });
}
