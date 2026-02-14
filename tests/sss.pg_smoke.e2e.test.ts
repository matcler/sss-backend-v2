import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { execSync } from "node:child_process";
import { SssRepository } from "../src/sss/db/repository";
import { SssService } from "../src/sss/service/sss.service";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";
import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import { ruleEngine } from "sss-rule-engine";
import { reduce } from "../src/sss/domain/reducer";
import { makeInitialSnapshot } from "../src/sss/domain/snapshot";
import {
  applySchema,
  assertSchemaReady,
  getPgConfigFromEnv,
  waitForPostgres,
} from "./_pgTestUtils";

const runSmoke = process.env.RUN_PG_SMOKE === "true";
const runTc = process.env.RUN_PG_SMOKE_TC === "true";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dockerOk = isDockerAvailable();
const enableTcSuite = runSmoke && runTc && dockerOk;
const enableExternalSuite = runSmoke && !runTc;

function randomSessionId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function createPgService(pool: Pool, snapshotEvery = 3, useContractGateway = false) {
  const repo = new SssRepository(pool);
  const gateway = useContractGateway
    ? new ContractRuleEngineGateway(ruleEngine)
    : allowAllRuleEngine;
  const svc = new SssService(repo, gateway, snapshotEvery);
  return { repo, svc };
}

async function ensureSchema(pool: Pool) {
  await waitForPostgres(pool, { timeoutMs: 30000 });
  try {
    await assertSchemaReady(pool);
  } catch {
    await applySchema(pool);
    await assertSchemaReady(pool);
  }
}

async function runSmokeSuite(pool: Pool) {
  const { repo, svc } = createPgService(pool, 3, true);

  // Smoke 1: turn engine minimal
  {
    const sessionId = randomSessionId("pg-smoke-turn");
    let state = await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Hero",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
          },
        },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e2",
            name: "Goblin",
            hp: 10,
            zone: null,
            position: { x: 1, y: 0 },
          },
        },
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
        { type: "COMBAT_STARTED", payload: { participant_ids: ["e1", "e2"] } },
        {
          type: "INITIATIVE_SET",
          payload: {
            entries: [
              { entityId: "e1", total: 10, source: "HUMAN_DECLARED" },
              { entityId: "e2", total: 5, source: "HUMAN_DECLARED" },
            ],
            order: ["e1", "e2"],
          },
        },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    expect(state.combat.active_entity).toBe("e2");
  }

  // Smoke 2: action window (1 action/turn)
  {
    const sessionId = randomSessionId("pg-smoke-action");
    let state = await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Hero",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
            ac: 10,
          },
        },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e2",
            name: "Goblin",
            hp: 10,
            zone: null,
            position: { x: 1, y: 0 },
            ac: 10,
          },
        },
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
        { type: "COMBAT_STARTED", payload: { participant_ids: ["e1", "e2"] } },
        {
          type: "INITIATIVE_SET",
          payload: {
            entries: [
              { entityId: "e1", total: 10, source: "HUMAN_DECLARED" },
              { entityId: "e2", total: 5, source: "HUMAN_DECLARED" },
            ],
            order: ["e1", "e2"],
          },
        },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "MOVE",
            destination: { x: 0, y: 1 },
          },
        },
      ],
    });

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [
          {
            type: "ACTION_PROPOSED",
            payload: {
              actorEntityId: "e1",
              actionType: "MOVE",
              destination: { x: 0, y: 2 },
            },
          },
        ],
      })
    ).rejects.toThrow(/ACTIONS_EXHAUSTED|rule denied/i);
  }

  // Smoke 3: snapshot + replay determinism
  {
    const svcSnap = new SssService(repo, allowAllRuleEngine, 2);
    const sessionId = randomSessionId("pg-smoke-snapshot");

    let state = await svcSnap.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Hero",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
          },
        },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e2",
            name: "Goblin",
            hp: 10,
            zone: null,
            position: { x: 1, y: 0 },
          },
        },
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
      ],
    });

    state = await svcSnap.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        { type: "ZONE_ADDED", payload: { zone_id: "Z1", name: "Arena" } },
      ],
    });

    const snap = await svcSnap.getState(sessionId);
    const snapshotRow = await repo.withTx((client) =>
      repo.getLatestSnapshot(client, sessionId)
    );

    expect(snapshotRow).not.toBeNull();
    expect(snapshotRow?.meta.version).toBe(snap.meta.version);

    const events = await svcSnap.getEvents(sessionId);
    const reduced = reduce(
      makeInitialSnapshot(sessionId, "5e"),
      events.map((e) => ({
        type: e.type,
        payload: e.payload,
        version: e.version,
      })) as any
    );

    expect(reduced.meta.version).toBe(snap.meta.version);
    expect(reduced.mode).toBe(snap.mode);
    expect(reduced.map.zones).toEqual(snap.map.zones);
  }
}

describe.runIf(enableExternalSuite)("Postgres smoke E2E (external)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool(getPgConfigFromEnv());
    await ensureSchema(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("runs smoke suite", async () => {
    await runSmokeSuite(pool);
  });
});

describe.runIf(enableTcSuite)("Postgres smoke E2E (testcontainers)", () => {
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

      await ensureSchema(pool);
    },
    60_000
  );

  afterAll(async () => {
    try {
      await pool?.end();
    } finally {
      await container?.stop();
    }
  });

  it("runs smoke suite", async () => {
    await runSmokeSuite(pool);
  });
});

if (runSmoke && runTc && !dockerOk) {
  describe("Postgres smoke E2E (testcontainers)", () => {
    it.skip(
      "Skipping Postgres smoke suite: Docker runtime not available. Start Docker Desktop or configure a container runtime.",
      () => {}
    );
  });
}
