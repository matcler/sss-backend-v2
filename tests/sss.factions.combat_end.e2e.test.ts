import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";

async function setupCombat(svc: SssService, sessionId: string) {
  return svc.appendEvents(sessionId, {
    expected_version: 0,
    events: [
      { type: "SESSION_CREATED", payload: { ruleset: "5e" } },
      { type: "RNG_SEEDED", payload: { seed: 1 } },
      {
        type: "ENTITY_ADDED",
        payload: {
          entity_id: "a1",
          name: "A1",
          hp: 10,
          zone: null,
          position: { x: 0, y: 0 },
          factionId: "A",
        },
      },
      {
        type: "ENTITY_ADDED",
        payload: {
          entity_id: "a2",
          name: "A2",
          hp: 10,
          zone: null,
          position: { x: 0, y: 1 },
          factionId: "A",
        },
      },
      {
        type: "ENTITY_ADDED",
        payload: {
          entity_id: "b1",
          name: "B1",
          hp: 10,
          zone: null,
          position: { x: 1, y: 0 },
          factionId: "B",
        },
      },
      {
        type: "ENTITY_ADDED",
        payload: {
          entity_id: "b2",
          name: "B2",
          hp: 10,
          zone: null,
          position: { x: 1, y: 1 },
          factionId: "B",
        },
      },
      { type: "MODE_SET", payload: { mode: "COMBAT" } },
      { type: "COMBAT_STARTED", payload: { participant_ids: ["a1", "a2", "b1", "b2"] } },
      {
        type: "INITIATIVE_SET",
        payload: {
          entries: [
            { entityId: "a1", total: 10, source: "HUMAN_DECLARED" },
            { entityId: "a2", total: 9, source: "HUMAN_DECLARED" },
            { entityId: "b1", total: 8, source: "HUMAN_DECLARED" },
            { entityId: "b2", total: 7, source: "HUMAN_DECLARED" },
          ],
          order: ["a1", "a2", "b1", "b2"],
        },
      },
    ],
  });
}

describe("C6 combat end by faction", () => {
  it("2v2: kill one from B -> combat continues", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "faction-2v2-continue";

    const state = await setupCombat(svc, sessionId);

    await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        { type: "DAMAGE_APPLIED", payload: { entity_id: "b1", amount: 10 } },
      ],
    });

    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.type)).not.toContain("COMBAT_ENDED");
  });

  it("kill last from B -> COMBAT_ENDED emitted", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "faction-2v2-end";

    let state = await setupCombat(svc, sessionId);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        { type: "DAMAGE_APPLIED", payload: { entity_id: "b1", amount: 10 } },
        { type: "DAMAGE_APPLIED", payload: { entity_id: "b2", amount: 10 } },
      ],
    });

    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.type)).toContain("COMBAT_ENDED");
    expect(state.combat.active).toBe(false);
  });

  it("auto-skip dead active does not end combat if >1 faction alive", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "faction-auto-skip";

    let state = await setupCombat(svc, sessionId);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        { type: "DAMAGE_APPLIED", payload: { entity_id: "a1", amount: 10 } },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const tail = events.slice(-2).map((e) => e.type);
    expect(tail).toEqual(["TURN_ENDED", "TURN_STARTED"]);
    expect(state.combat.active).toBe(true);
  });

  it("all dead -> COMBAT_ENDED", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "faction-all-dead";

    let state = await setupCombat(svc, sessionId);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        { type: "DAMAGE_APPLIED", payload: { entity_id: "a1", amount: 10 } },
        { type: "DAMAGE_APPLIED", payload: { entity_id: "a2", amount: 10 } },
        { type: "DAMAGE_APPLIED", payload: { entity_id: "b1", amount: 10 } },
        { type: "DAMAGE_APPLIED", payload: { entity_id: "b2", amount: 10 } },
      ],
    });

    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.type)).toContain("COMBAT_ENDED");
    expect(state.combat.active).toBe(false);
  });
});
