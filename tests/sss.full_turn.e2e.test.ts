import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import { ruleEngine } from "sss-rule-engine";

describe("E2E: turno completo (MOVE -> ADVANCE_TURN)", () => {
  it("advances to next entity and returns to ACTION phase", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);

    const sessionId = "e2e-full-turn";

    let state = await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Attacker",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
            level: 1,
            str: 16,
            proficient: true,
            attack_ability: "STR",
            weapon_damage: { count: 1, sides: 8 },
          },
        },
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e2",
            name: "Target",
            hp: 10,
            zone: null,
            position: { x: 2, y: 0 },
            ac: 12,
          },
        },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "MODE_SET", payload: { mode: "COMBAT" } }],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "COMBAT_STARTED", payload: { participant_ids: ["e1", "e2"] } }],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "INITIATIVE_SET",
          payload: {
            entries: [
              { entityId: "e1", total: 10, source: "HUMAN_DECLARED" },
              { entityId: "e2", total: 10, source: "HUMAN_DECLARED" },
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
            destination: { x: 1, y: 0 },
          },
        },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    expect(state.combat.active_entity).toBe("e2");
    expect(state.combat.phase).toBe("ACTION");
  });
});
