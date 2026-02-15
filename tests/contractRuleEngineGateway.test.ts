import { describe, expect, test, vi } from "vitest";

import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import type { RuleEngine, ReDecision } from "../src/sss/rule-engine/reContract";
import { ReasonCode } from "../src/sss/rule-engine/reContract";
import type { DomainEvent, Snapshot } from "../src/sss/domain/types";

function makeBaseSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  // Fill only fields read by the gateway; keep this test resilient to unrelated domain changes.
  const base = {
    meta: { session_id: "s1", version: 0, ruleset: "5e" },
    mode: "COMBAT",
    combat: {
      active: true,
      phase: "ACTION_WINDOW", // SSS: START | ACTION_WINDOW | END
      active_entity: "e1",
      initiative: [{ entity_id: "e1" }, { entity_id: "e2" }],
      action_used: false,
      movement_remaining: 6,
      turn_actions_used: 0,
    },
    entities: {
      e1: { id: "e1", hp: 10, zone: "A1" },
      e2: { id: "e2", hp: 10, zone: "A1" },
    },
  } as any as Snapshot;

  return { ...base, ...(overrides ?? {}) };
}

describe("ContractRuleEngineGateway", () => {
  test("passes mapped TURN_ENDED to contract engine and forwards denial", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({
        allowed: false,
        code: ReasonCode.NOT_YOUR_TURN,
      })),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot({
      combat: { ...makeBaseSnapshot().combat, active_entity: "e2" } as any,
    });

    const ev: DomainEvent = {
      type: "TURN_ENDED",
      payload: { entity_id: "e1" },
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(engine.evaluate).toHaveBeenCalledTimes(1);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe(ReasonCode.NOT_YOUR_TURN);
    }
  });

  test("ADVANCE_TURN mapping: actorEntityId is forwarded", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot({
      combat: { ...makeBaseSnapshot().combat, active_entity: "e1" } as any,
    });

    const ev: DomainEvent = {
      type: "ADVANCE_TURN",
      payload: { actorEntityId: "e1" },
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    const [reSnap, reEv] = (engine.evaluate as any).mock.calls[0];

    // Sanity checks on mapping
    expect(reSnap.mode).toBe("COMBAT");
    expect(reSnap.combat.activeEntityId).toBe("e1");
    expect(reEv.type).toBe("ADVANCE_TURN");
    expect(reEv.actorEntityId).toBe("e1");
  });

  test("ADVANCE_TURN mapping accepts actor aliases (entity_id)", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };
    const gw = new ContractRuleEngineGateway(engine);
    const snap = makeBaseSnapshot();

    const ev: DomainEvent = {
      type: "ADVANCE_TURN",
      payload: { entity_id: "e1" },
    } as any;

    const decision = gw.evaluate(snap, ev);
    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    const [, reEv] = (engine.evaluate as any).mock.calls[0];
    expect(reEv.type).toBe("ADVANCE_TURN");
    expect(reEv.actorEntityId).toBe("e1");
  });

  test("ACTION_PROPOSED PASS is mapped and forwarded", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };
    const gw = new ContractRuleEngineGateway(engine);
    const snap = makeBaseSnapshot();

    const ev: DomainEvent = {
      type: "ACTION_PROPOSED",
      payload: { actorEntityId: "e1", actionType: "PASS" },
    } as any;

    const decision = gw.evaluate(snap, ev);
    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    const [, reEv] = (engine.evaluate as any).mock.calls[0];
    expect(reEv.type).toBe("ACTION_PROPOSED");
    expect(reEv.actorEntityId).toBe("e1");
    expect(reEv.payload.actionType).toBe("PASS");
  });

  test("ACTION_PROPOSED supports nested action.type payload shape", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };
    const gw = new ContractRuleEngineGateway(engine);
    const snap = makeBaseSnapshot();

    const ev: DomainEvent = {
      type: "ACTION_PROPOSED",
      payload: {
        actorEntityId: "e1",
        action: { type: "PASS" },
      },
    } as any;

    const decision = gw.evaluate(snap, ev);
    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    const [, reEv] = (engine.evaluate as any).mock.calls[0];
    expect(reEv.type).toBe("ACTION_PROPOSED");
    expect(reEv.actorEntityId).toBe("e1");
    expect(reEv.payload.actionType).toBe("PASS");
  });

  test("ACTION_PROPOSED supports actor_entity alias", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };
    const gw = new ContractRuleEngineGateway(engine);
    const snap = makeBaseSnapshot();

    const ev: DomainEvent = {
      type: "ACTION_PROPOSED",
      payload: {
        actor_entity: "e1",
        action: { type: "PASS" },
      },
    } as any;

    const decision = gw.evaluate(snap, ev);
    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    const [, reEv] = (engine.evaluate as any).mock.calls[0];
    expect(reEv.type).toBe("ACTION_PROPOSED");
    expect(reEv.actorEntityId).toBe("e1");
    expect(reEv.payload.actionType).toBe("PASS");
  });

  test("events not in the gated set are allowed by default and do not call the contract engine", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({
        allowed: false,
        code: ReasonCode.UNKNOWN_EVENT,
      })),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot();

    const ev: DomainEvent = {
      type: "SESSION_CREATED",
      payload: { ruleset: "5e" },
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(0);
  });

  test("ROLL_INITIATIVE is allowed only for whitelisted AI actors (no RE call)", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };

    const gw = new ContractRuleEngineGateway(engine, {
      aiEntityWhitelist: ["ai-1"],
    });

    const snap = makeBaseSnapshot({
      combat: {
        ...makeBaseSnapshot().combat,
        active_entity: "ai-1",
        active: true,
        initiative: [],
      } as any,
    });

    const evAllowed: DomainEvent = {
      type: "ACTION_PROPOSED",
      payload: {
        actorEntityId: "ai-1",
        actionType: "ROLL_INITIATIVE",
      },
    } as any;

    const ok = gw.evaluate(snap, evAllowed);
    expect(ok.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(0);

    const evDenied: DomainEvent = {
      type: "ACTION_PROPOSED",
      payload: {
        actorEntityId: "human-1",
        actionType: "ROLL_INITIATIVE",
      },
    } as any;

    const denied = gw.evaluate(snap, evDenied);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.code).toBe("DENY_INITIATIVE");
    }
  });

  test("INITIATIVE_SET denied when mode is not COMBAT even if combat is active", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };

    const gw = new ContractRuleEngineGateway(engine, {
      aiEntityWhitelist: ["ai-1"],
    });

    const snap = makeBaseSnapshot({
      mode: "EXPLORATION",
      combat: { ...makeBaseSnapshot().combat, active: true } as any,
      entities: {
        "ai-1": { id: "ai-1", hp: 10, zone: "A1" },
      } as any,
    });

    const ev: DomainEvent = {
      type: "INITIATIVE_SET",
      payload: {
        entries: [{ entityId: "ai-1", total: 10, source: "HUMAN_DECLARED" }],
        order: ["ai-1"],
      },
    } as any;

    const decision = gw.evaluate(snap, ev);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("DENY_INITIATIVE");
    }
  });

  test("INITIATIVE_SET denied when not all present AI ids are included", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };

    const gw = new ContractRuleEngineGateway(engine, {
      aiEntityWhitelist: ["ai-1", "ai-2"],
    });

    const snap = makeBaseSnapshot({
      mode: "COMBAT",
      combat: { ...makeBaseSnapshot().combat, active: true } as any,
      entities: {
        "ai-1": { id: "ai-1", hp: 10, zone: "A1" },
        "ai-2": { id: "ai-2", hp: 10, zone: "A1" },
      } as any,
    });

    const ev: DomainEvent = {
      type: "INITIATIVE_SET",
      payload: {
        entries: [{ entityId: "ai-1", total: 10, source: "HUMAN_DECLARED" }],
        order: ["ai-1"],
      },
    } as any;

    const decision = gw.evaluate(snap, ev);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("DENY_INITIATIVE");
    }
  });
});
