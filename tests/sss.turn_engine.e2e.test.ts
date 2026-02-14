import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";
import { ruleEngine } from "sss-rule-engine";
import { makeInitialSnapshot } from "../src/sss/domain/snapshot";
import { reduce } from "../src/sss/domain/reducer";
import type { DomainEvent } from "../src/sss/domain/types";
import { ValidationError } from "../src/sss/domain/errors";

async function setupCombat(
  svc: SssService,
  sessionId: string,
  order: string[],
  hpById: Record<string, number> = {}
) {
  let state = await svc.appendEvents(sessionId, {
    expected_version: 0,
    events: [{ type: "SESSION_CREATED", payload: { ruleset: "5e" } }],
  });

  state = await svc.appendEvents(sessionId, {
    expected_version: state.meta.version,
    events: [{ type: "MODE_SET", payload: { mode: "COMBAT" } }],
  });

  state = await svc.appendEvents(sessionId, {
    expected_version: state.meta.version,
    events: order.map((id) => ({
      type: "ENTITY_ADDED",
      payload: {
        entity_id: id,
        name: id,
        hp: hpById[id] != null && hpById[id] > 0 ? hpById[id] : 10,
        zone: null,
      },
    })),
  });

  const toKill = Object.entries(hpById)
    .filter(([, hp]) => hp != null && hp <= 0)
    .map(([id]) => id);
  if (toKill.length > 0) {
    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: toKill.map((id) => ({
        type: "DAMAGE_APPLIED",
        payload: { entity_id: id, amount: state.entities[id].hp },
      })),
    });
  }

  state = await svc.appendEvents(sessionId, {
    expected_version: state.meta.version,
    events: [{ type: "COMBAT_STARTED", payload: { participant_ids: order } }],
  });

  const entries = order.map((entityId) => ({
    entityId,
    total: 10,
    source: "HUMAN_DECLARED",
  }));

  state = await svc.appendEvents(sessionId, {
    expected_version: state.meta.version,
    events: [{ type: "INITIATIVE_SET", payload: { entries, order } }],
  });

  return state;
}

describe("E2E: minimal C3 turn engine", () => {
  it("advance e1->e2 emits TURN_ENDED + TURN_STARTED", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "turn-engine-advance";

    let state = await setupCombat(svc, sessionId, ["e1", "e2"]);
    const active = state.combat.active_entity;
    if (!active) throw new Error("active_entity missing");

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: active } }],
    });

    const events = await svc.getEvents(sessionId);
    const tail = events.slice(-3).map((e) => e.type);
    expect(tail).toEqual(["ADVANCE_TURN", "TURN_ENDED", "TURN_STARTED"]);

    expect(state.combat.active_entity).toBe("e2");
  });

  it("wrap increments round", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "turn-engine-wrap";

    let state = await setupCombat(svc, sessionId, ["e1", "e2"]);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e2" } }],
    });

    expect(state.combat.active_entity).toBe("e1");
    expect(state.combat.cursor).toBe(0);
    expect(state.combat.round).toBe(2);
  });

  it("skips dead entity", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "turn-engine-skip-dead";

    let state = await setupCombat(svc, sessionId, ["e1", "e2", "e3"], { e2: 0 });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    expect(state.combat.active_entity).toBe("e3");
    expect(state.combat.cursor).toBe(1);
  });

  it("combat ends when <=1 alive", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "turn-engine-combat-ended";

    const state = await setupCombat(svc, sessionId, ["e1", "e2"], { e2: 0 });

    expect(state.combat.active).toBe(false);
    expect(state.combat.active_entity).toBeNull();

    const events = await svc.getEvents(sessionId);
    expect(events.at(-1)?.type).toBe("COMBAT_ENDED");
  });

  it("denies when actor is not active_entity", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine);
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "turn-engine-deny-not-active";

    const state = await setupCombat(svc, sessionId, ["e1", "e2"]);

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e2" } }],
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("replay determinism on round/cursor/active_entity", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "turn-engine-replay";

    let state = await setupCombat(svc, sessionId, ["e1", "e2", "e3"], { e2: 0 });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e3" } }],
    });

    const events = await svc.getEvents(sessionId);
    const domainEvents: DomainEvent[] = events.map((e) => ({
      type: e.type as DomainEvent["type"],
      payload: e.payload as any,
      version: e.version,
    }));

    const base = makeInitialSnapshot(sessionId, "5e");
    const replayed = reduce(base, domainEvents);

    expect(replayed.combat.round).toBe(state.combat.round);
    expect(replayed.combat.cursor).toBe(state.combat.cursor);
    expect(replayed.combat.active_entity).toBe(state.combat.active_entity);
  });
});
