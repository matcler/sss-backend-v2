import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";

async function setupCombat(svc: SssService, sessionId: string) {
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

  return state;
}

describe("C4.1 auto-skip dead active entity (E2E)", () => {
  it("active dies -> TURN_ENDED(SKIP_DEAD) + TURN_STARTED(next)", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "auto-skip-dead";

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
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e3",
            name: "Orc",
            hp: 10,
            zone: null,
            position: { x: 2, y: 0 },
          },
        },
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
        { type: "COMBAT_STARTED", payload: { participant_ids: ["e1", "e2", "e3"] } },
        {
          type: "INITIATIVE_SET",
          payload: {
            entries: [
              { entityId: "e1", total: 10, source: "HUMAN_DECLARED" },
              { entityId: "e2", total: 5, source: "HUMAN_DECLARED" },
              { entityId: "e3", total: 1, source: "HUMAN_DECLARED" },
            ],
            order: ["e1", "e2", "e3"],
          },
        },
      ],
    });

    expect(state.combat.active_entity).toBe("e1");

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "DAMAGE_APPLIED",
          payload: { entity_id: "e1", amount: 10 },
        },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const tail = events.slice(-2);
    expect(tail.map((e) => e.type)).toEqual(["TURN_ENDED", "TURN_STARTED"]);
    expect((tail[0] as any).payload.reason).toBe("SKIP_DEAD");
    expect(state.combat.active_entity).toBe("e2");
    expect(state.combat.active).toBe(true);
  });

  it("active dies and combat ends -> COMBAT_ENDED only", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "auto-skip-combat-end";

    let state = await setupCombat(svc, sessionId);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "DAMAGE_APPLIED",
          payload: { entity_id: "e1", amount: 10 },
        },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const tail = events.slice(-2);
    expect(tail.map((e) => e.type)).toEqual(["TURN_ENDED", "COMBAT_ENDED"]);
    expect((tail[0] as any).payload.reason).toBe("SKIP_DEAD");
    expect(state.combat.active).toBe(false);
  });

  it("TURN_STARTED on dead active triggers auto-skip", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "auto-skip-turn-started";

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
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e3",
            name: "Orc",
            hp: 10,
            zone: null,
            position: { x: 2, y: 0 },
          },
        },
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
        { type: "COMBAT_STARTED", payload: { participant_ids: ["e1", "e2", "e3"] } },
        {
          type: "INITIATIVE_SET",
          payload: {
            entries: [
              { entityId: "e1", total: 10, source: "HUMAN_DECLARED" },
              { entityId: "e2", total: 5, source: "HUMAN_DECLARED" },
              { entityId: "e3", total: 1, source: "HUMAN_DECLARED" },
            ],
            order: ["e1", "e2", "e3"],
          },
        },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "DAMAGE_APPLIED",
          payload: { entity_id: "e1", amount: 10 },
        },
      ],
    });

    const before = await svc.getEvents(sessionId);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "TURN_STARTED",
          payload: { entityId: "e1", round: state.combat.round },
        },
      ],
    });

    const after = await svc.getEvents(sessionId);
    const slice = after.slice(before.length).map((e) => e.type);
    expect(slice).toEqual(["TURN_STARTED", "TURN_ENDED", "TURN_STARTED"]);

    expect(state.combat.active_entity).toBe("e2");
  });
});
