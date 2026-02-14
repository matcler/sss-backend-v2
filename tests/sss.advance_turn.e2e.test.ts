import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";

describe("E2E: ADVANCE_TURN via SssService.appendEvents + InMemory repo", () => {
  it("happy: ... -> MODE_SET(COMBAT) -> ADVANCE_TURN", async () => {
    const repo = new InMemorySssRepository();
    const sss = new SssService(repo as any);

    const session_id = "e2e-advance-turn-happy";
    const zone_id = "Z1";

    let state = await sss.appendEvents(session_id, {
      expected_version: 0,
      events: [{ type: "SESSION_CREATED", payload: { ruleset: "5e" } }],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "ZONE_ADDED", payload: { zone_id, name: "Arena" } }],
    });

    const participant_ids = ["E1", "E2", "E3"];
    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [
        { type: "ENTITY_ADDED", payload: { entity_id: "E1", name: "E1", hp: 10, zone: zone_id } },
        { type: "ENTITY_ADDED", payload: { entity_id: "E2", name: "E2", hp: 10, zone: zone_id } },
        { type: "ENTITY_ADDED", payload: { entity_id: "E3", name: "E3", hp: 10, zone: zone_id } },
      ],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "COMBAT_STARTED", payload: { participant_ids } }],
    });

    const order = ["E1", "E2", "E3"];
    const entries = order.map((entityId) => ({
      entityId,
      total: 10,
      source: "HUMAN_DECLARED",
    }));
    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "INITIATIVE_SET", payload: { entries, order } }],
    });

    // 🔑 necessario per validate ADVANCE_TURN: snapshot.mode deve essere "COMBAT"
    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "MODE_SET", payload: { mode: "COMBAT" } }],
    });

    const activeEntity = state.combat.active_entity;
    if (!activeEntity) {
      throw new Error("active_entity is null in test setup");
    }

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: activeEntity } }],
    });


    expect(state.combat.cursor).toBe(1);
    expect(state.combat.active_entity).toBe(order[1]);
  });

  it("conflict: expected_version errato deve lanciare", async () => {
    const repo = new InMemorySssRepository();
    const sss = new SssService(repo as any);

    const session_id = "e2e-advance-turn-conflict";
    const zone_id = "Z1";
    const participant_ids = ["E1", "E2"];

    let state = await sss.appendEvents(session_id, {
      expected_version: 0,
      events: [{ type: "SESSION_CREATED", payload: { ruleset: "5e" } }],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "ZONE_ADDED", payload: { zone_id, name: "Arena" } }],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [
        { type: "ENTITY_ADDED", payload: { entity_id: "E1", name: "E1", hp: 10, zone: zone_id } },
        { type: "ENTITY_ADDED", payload: { entity_id: "E2", name: "E2", hp: 10, zone: zone_id } },
      ],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "COMBAT_STARTED", payload: { participant_ids } }],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [
        {
          type: "INITIATIVE_SET",
          payload: {
            entries: [
              { entityId: "E1", total: 10, source: "HUMAN_DECLARED" },
              { entityId: "E2", total: 10, source: "HUMAN_DECLARED" },
            ],
            order: ["E1", "E2"],
          },
        },
      ],
    });

    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "MODE_SET", payload: { mode: "COMBAT" } }],
    });

    // Qui la current version è l'ultima meta.version; usiamo volutamente quella - 1
    await expect(
      sss.appendEvents(session_id, {
        expected_version: state.meta.version - 1,
        events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "E1" } }],
      })
    ).rejects.toThrow(/version (mismatch|conflict)/i);
  });
});




