import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import { ruleEngine } from "../src/sss/rule-engine/localContractRuleEngine";

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
  it("PASS consumes action, ends phase, keeps state deterministic, then ADVANCE_TURN resets window", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "action-window-pass";

    let state = await setupCombat(svc, sessionId, {
      e1Pos: { x: 0, y: 0 },
      e2Pos: { x: 1, y: 0 },
    });
    const e1HpBefore = state.entities["e1"].hp;
    const e2HpBefore = state.entities["e2"].hp;
    const e1PosBefore = state.entities["e1"].position;
    const e2PosBefore = state.entities["e2"].position;

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "PASS",
          },
        },
      ],
    });

    expect(state.combat.action_used).toBe(true);
    expect(state.combat.turn_actions_used).toBe(1);
    expect(state.combat.phase).toBe("END");
    expect(state.entities["e1"].hp).toBe(e1HpBefore);
    expect(state.entities["e2"].hp).toBe(e2HpBefore);
    expect(state.entities["e1"].position).toEqual(e1PosBefore);
    expect(state.entities["e2"].position).toEqual(e2PosBefore);

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [
          {
            type: "ACTION_PROPOSED",
            payload: {
              actorEntityId: "e1",
              actionType: "PASS",
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
    expect(state.combat.phase).toBe("ACTION_WINDOW");
    expect(state.combat.action_used).toBe(false);
    expect(state.combat.movement_remaining).toBe(6);
    expect(state.combat.turn_actions_used).toBe(0);
  });

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

  it("accepts ACTION_PROPOSED PASS with actor_entity + action.type aliases", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "action-window-pass-aliases";

    let state = await setupCombat(svc, sessionId);
    expect(state.combat.phase).toBe("ACTION_WINDOW");
    expect(state.combat.action_used).toBe(false);
    expect(state.combat.movement_remaining).toBe(6);
    expect(state.combat.turn_actions_used).toBe(0);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actor_entity: "e1",
            action: { type: "PASS" },
          },
        } as any,
      ],
    });

    expect(state.combat.phase).toBe("END");
    expect(state.combat.action_used).toBe(true);
    expect(state.combat.turn_actions_used).toBe(1);
  });

  it("MOVE keeps ACTION_WINDOW, spends movement, and ADVANCE_TURN is denied until action_used=true", async () => {
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
    expect(state.combat.phase).toBe("ACTION_WINDOW");
    expect(state.combat.action_used).toBe(false);
    expect(state.combat.movement_remaining).toBe(5);

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
      })
    ).rejects.toThrow(/ADVANCE_TURN denied|WRONG_PHASE|rule denied/i);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "PASS",
          },
        },
      ],
    });
    expect(state.combat.phase).toBe("END");
    expect(state.combat.action_used).toBe(true);

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

    expect(state.combat.phase).toBe("ACTION_WINDOW");
    expect(state.combat.action_used).toBe(false);
    expect(state.combat.movement_remaining).toBe(5);
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
    expect(state.combat.phase).toBe("ACTION_WINDOW");
    expect(state.combat.action_used).toBe(true);
  });

  it("replay determinism for active_entity and economy fields", async () => {
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
    expect(replayed.combat.action_used).toBe(state.combat.action_used);
    expect(replayed.combat.movement_remaining).toBe(state.combat.movement_remaining);
    expect(replayed.combat.turn_actions_used).toBe(state.combat.turn_actions_used);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "e1", actionType: "PASS" },
        },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "e2", actionType: "PASS" },
        },
      ],
    });

    replayed = await svc.getState(sessionId);
    expect(replayed.combat.active_entity).toBe(state.combat.active_entity);
    expect(replayed.combat.action_used).toBe(state.combat.action_used);
    expect(replayed.combat.movement_remaining).toBe(state.combat.movement_remaining);
    expect(replayed.combat.turn_actions_used).toBe(state.combat.turn_actions_used);
  });
});
