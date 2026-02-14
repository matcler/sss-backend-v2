import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import { ruleEngine } from "sss-rule-engine";

async function setupCombat(
  svc: SssService,
  sessionId: string,
  options?: { e1Ac?: number; e2Ac?: number; e1Pos?: { x: number; y: number }; e2Pos?: { x: number; y: number } }
) {
  const e1Pos = options?.e1Pos ?? { x: 0, y: 0 };
  const e2Pos = options?.e2Pos ?? { x: 1, y: 0 };
  const e1Ac = options?.e1Ac ?? 10;
  const e2Ac = options?.e2Ac ?? 10;

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
          position: e1Pos,
          ac: e1Ac,
        },
      },
      {
        type: "ENTITY_ADDED",
        payload: {
          entity_id: "e2",
          name: "Goblin",
          hp: 10,
          zone: null,
          position: e2Pos,
          ac: e2Ac,
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

  return state;
}

describe("C4 Action Window (E2E)", () => {
  it("denies ACTION_PROPOSED from non-active actor", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "action-window-non-active";

    const state = await setupCombat(svc, sessionId);
    expect(state.combat.active_entity).toBe("e1");

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [
          {
            type: "ACTION_PROPOSED",
            payload: {
              actorEntityId: "e2",
              actionType: "MOVE",
              destination: { x: 2, y: 0 },
            },
          },
        ],
      })
    ).rejects.toThrow(/NOT_YOUR_TURN|rule denied/i);
  });

  it("allows one action per turn and resets on ADVANCE_TURN", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "action-window-once";

    let state = await setupCombat(svc, sessionId, { e2Ac: 100 });

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

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    expect(state.combat.active_entity).toBe("e2");

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e2",
            actionType: "MOVE",
            destination: { x: 1, y: 1 },
          },
        },
      ],
    });

    expect(state.combat.turn_actions_used).toBe(1);
  });

  it("ATTACK miss still emits ACTION_RESOLVED and consumes action", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "action-window-miss";

    let state = await setupCombat(svc, sessionId);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "ATTACK",
            targetEntityId: "e2",
          },
        },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const types = events.map((e) => e.type);
    expect(types).toContain("ACTION_RESOLVED");

    await expect(
      svc.appendEvents(sessionId, {
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
      })
    ).rejects.toThrow(/ACTIONS_EXHAUSTED|rule denied/i);
  });

  it("replay determinism for active_entity and turn_actions_used", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "action-window-replay";

    let state = await setupCombat(svc, sessionId);

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

    let replayed = await svc.getState(sessionId);
    expect(replayed.combat.active_entity).toBe(state.combat.active_entity);
    expect(replayed.combat.turn_actions_used).toBe(state.combat.turn_actions_used);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    replayed = await svc.getState(sessionId);
    expect(replayed.combat.active_entity).toBe(state.combat.active_entity);
    expect(replayed.combat.turn_actions_used).toBe(state.combat.turn_actions_used);
  });
});
